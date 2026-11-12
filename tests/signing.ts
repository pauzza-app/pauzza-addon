// Test-only: signs offer lists with a throwaway key, the way the owner's
// signing tool does, so the tests can show the add-on real signed lists. The
// add-on itself can only check signatures; it has no way to make one.

import { add, BASE, encodePoint, fromLittleEndian, L, multiply, sha512 } from '../hooks/ed25519'

void add

export type TestKey = { publicKey: string; scalar: bigint; prefix: Uint8Array; publicBytes: Uint8Array }

const toBase64 = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))
const utf8 = (text: string) => new TextEncoder().encode(text)

function littleEndian(value: bigint): Uint8Array {
  const out = new Uint8Array(32)
  let left = value

  for (let i = 0; i < 32; i += 1) {
    out[i] = Number(left & 0xffn)
    left >>= 8n
  }

  return out
}

export async function testKey(seedByte: number): Promise<TestKey> {
  const hash = await sha512(new Uint8Array(32).fill(seedByte))
  const low = hash.slice(0, 32)
  low[0] &= 248
  low[31] &= 127
  low[31] |= 64
  const scalar = fromLittleEndian(low)
  const publicBytes = encodePoint(multiply(BASE, scalar))

  return { publicKey: toBase64(publicBytes), scalar, prefix: hash.slice(32), publicBytes }
}

export async function signBytes(key: TestKey, message: Uint8Array): Promise<Uint8Array> {
  const r = fromLittleEndian(await sha512(key.prefix, message)) % L
  const point = encodePoint(multiply(BASE, r))
  const k = fromLittleEndian(await sha512(point, key.publicBytes, message)) % L
  const out = new Uint8Array(64)
  out.set(point)
  out.set(littleEndian((r + k * key.scalar) % L), 32)

  return out
}

// The envelope the server serves: the exact payload text and its signature.
export async function signCatalogue(key: TestKey, catalogue: unknown, keyId = 'test-1'): Promise<string> {
  const payload = typeof catalogue === 'string' ? catalogue : JSON.stringify(catalogue)

  return JSON.stringify({ v: 1, keyId, payload, sig: toBase64(await signBytes(key, utf8(payload))) })
}
