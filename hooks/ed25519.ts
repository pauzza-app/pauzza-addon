// Ed25519 signature check (RFC 8032), for the signed offer list. Pure, with no
// dependency: the tool's runtime offers SHA-512 but no Ed25519 of its own
// (tested 2026-11-11: `crypto.subtle` has `digest` only).
//
// Verification only, on public data, so nothing here needs to run in constant
// time. The point helpers are exported for the tests, which sign their own
// lists with a throwaway key. Nothing here can throw: any oddity means "no".

const P = 2n ** 255n - 19n
export const L = 2n ** 252n + 27742317777372353535851937790883648493n
const D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n
const SQRT_M1 = 19681161376707505956807079304988542015446066515923890162744021073123829784752n
const BASE_X = 15112221349535400772501151409588531511454012693041857206046113283949847762202n
const BASE_Y = 46316835694926478169428394003475163141307993866256225615783033603165251855960n

export type Point = { x: bigint; y: bigint; z: bigint; t: bigint }

const mod = (value: bigint, by = P) => ((value % by) + by) % by

function power(base: bigint, exponent: bigint): bigint {
  let result = 1n
  let square = mod(base)

  for (let left = exponent; left > 0n; left >>= 1n) {
    if (left & 1n) {
      result = (result * square) % P
    }

    square = (square * square) % P
  }

  return result
}

const invert = (value: bigint) => power(value, P - 2n)

export const BASE: Point = { x: BASE_X, y: BASE_Y, z: 1n, t: mod(BASE_X * BASE_Y) }
const ZERO: Point = { x: 0n, y: 1n, z: 1n, t: 0n }

// One formula for adding and doubling; complete on this curve.
export function add(p: Point, q: Point): Point {
  const a = mod((p.y - p.x) * (q.y - q.x))
  const b = mod((p.y + p.x) * (q.y + q.x))
  const c = mod(2n * D * p.t * q.t)
  const d = mod(2n * p.z * q.z)
  const e = b - a
  const f = d - c
  const g = d + c
  const h = b + a

  return { x: mod(e * f), y: mod(g * h), z: mod(f * g), t: mod(e * h) }
}

export function multiply(point: Point, scalar: bigint): Point {
  let result = ZERO
  let doubled = point

  for (let left = scalar; left > 0n; left >>= 1n) {
    if (left & 1n) {
      result = add(result, doubled)
    }

    doubled = add(doubled, doubled)
  }

  return result
}

export function fromLittleEndian(bytes: Uint8Array): bigint {
  let value = 0n

  for (let i = bytes.length - 1; i >= 0; i -= 1) {
    value = (value << 8n) | BigInt(bytes[i])
  }

  return value
}

export function encodePoint(point: Point): Uint8Array {
  const inverse = invert(point.z)
  const x = mod(point.x * inverse)
  let y = mod(point.y * inverse)
  const out = new Uint8Array(32)

  for (let i = 0; i < 32; i += 1) {
    out[i] = Number(y & 0xffn)
    y >>= 8n
  }

  out[31] |= Number(x & 1n) << 7

  return out
}

// The point a 32-byte value stands for, or undefined if it stands for none.
export function decodePoint(bytes: Uint8Array): Point | undefined {
  if (bytes.length !== 32) {
    return undefined
  }

  const copy = Uint8Array.from(bytes)
  const sign = copy[31] >> 7
  copy[31] &= 0x7f
  const y = fromLittleEndian(copy)

  if (y >= P) {
    return undefined
  }

  const top = mod(y * y - 1n)
  const bottom = mod(D * y * y + 1n)
  const x2 = mod(top * invert(bottom))
  let x = power(x2, (P + 3n) / 8n)

  if (mod(x * x) !== x2) {
    x = mod(x * SQRT_M1)
  }

  if (mod(x * x) !== x2 || (x === 0n && sign === 1)) {
    return undefined
  }

  if (Number(x & 1n) !== sign) {
    x = P - x
  }

  return { x, y, z: 1n, t: mod(x * y) }
}

export async function sha512(...parts: Uint8Array[]): Promise<Uint8Array> {
  const all = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0

  for (const part of parts) {
    all.set(part, at)
    at += part.length
  }

  return new Uint8Array(await crypto.subtle.digest('SHA-512', all))
}

const isSame = (p: Point, q: Point) => mod(p.x * q.z) === mod(q.x * p.z) && mod(p.y * q.z) === mod(q.y * p.z)

// True only if `signature` (64 bytes) is `publicKey`'s (32 bytes) over `message`.
export async function verify(publicKey: Uint8Array, signature: Uint8Array, message: Uint8Array): Promise<boolean> {
  try {
    if (publicKey.length !== 32 || signature.length !== 64) {
      return false
    }

    const key = decodePoint(publicKey)
    const r = decodePoint(signature.slice(0, 32))
    const s = fromLittleEndian(signature.slice(32))

    if (key === undefined || r === undefined || s >= L) {
      return false
    }

    const k = mod(fromLittleEndian(await sha512(signature.slice(0, 32), publicKey, message)), L)

    return isSame(multiply(BASE, s), add(r, multiply(key, k)))
  } catch {
    return false
  }
}
