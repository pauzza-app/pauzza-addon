import type { EngineInterface, Register } from 'claude-code'

import { blankSvg, dotsSvg, dotsWidth, drawerColour, fadedSvg, hairlineSvg, iconTileSvg, logoTileSvg } from './art'
import { loadingSvg, loadingTileSvg } from './loadings'
import { canAnimate, statusFor, currentWindow, drawMeter, formatReset, isLimited, METERS, presentNote, pickFiveHour, pickLimit, pickWeekly, SAMPLE_PERCENT, statusLine } from './meters'
import type { MeterDisplay, MeterId, StatusInput } from './meters'
import { accept, consentLine, decline, dismissUpdate, finishDelete, isRunning, noteInviteSeen, readConsent, shouldDelete, undoSecondsLeft, viewOf, withdraw } from './consent'
import type { ConsentRecord } from './consent'
import { CONSENT_TEXT, documentUrl, hasPublicRepo, TERMS_CHANGE_NOTE } from './consent-text'
import type { DocumentFile } from './consent-text'
import { checkLink } from './catalogue'
import type { Catalogue, ServerOffer } from './catalogue'
import { canOfferConnect, CONNECT_TEXT, OFFER_POPUP } from './connect-text'
import { canUndo, isConnected, maskCode, newlyOpen, offerState, readPopups, takePopup, undoSecondsLeft as connectionUndoSecondsLeft } from './connection'
import type { ConnectionRecord, StoredCode } from './connection'
import { checkLine, isBuiltInPopup, officialLink, offerLink } from './display'
import { CODE_FORMAT, parseCatalog, sortOffers } from './offers'
import {
  claimNote,
  claimOffer,
  clearOnceNotes,
  connectNow,
  currentConnectNote,
  currentDisconnectNote,
  disconnectNow,
  isUnreachable,
  loadCodes,
  loadConnection,
  loadRelease,
  networkTick,
  POPUPS_KEY,
  pruneCodes,
  serverView,
  TICK_MS,
  undoDisconnectNow,
  wakeServerLink,
} from './server-link'
import type { Catalog, Prize } from './offers'
import {
  addWait,
  assignFirstMeter,
  canPopUp,
  claimReward,
  clearMark,
  createWaitTimer,
  DAILY_CAP_MINUTES,
  dropOfDay,
  hasBurnWeek,
  isDropUnlocked,
  nextMilestone,
  noteCopied,
  noteMilestones,
  pickMeter,
  presentProgress,
  reachedMilestones,
  readSaved,
  readyRewards,
  takeBurnouts,
  takePopups,
  trackWindow,
} from './waiting-pays'
import type { Saved } from './waiting-pays'

const PANE = 'pauzza-offers'
const PANE_TITLE = 'Pauzza (test)'
const STORE_KEY = 'saved'
const CONSENT_KEY = 'consent'
const DRAWER_ICONS: Record<string, string> = { mine: '🎁', day: '⭐', food: '🍕', drinks: '🥤', tickets: '🎟', gadgets: '🎧' }
const DISPLAY_CHOICES: ReadonlyArray<[MeterDisplay, string]> = [['always', 'Always'], ['ready', 'When ready'], ['off', 'Off']]
const CARD_FILL = '#8888881A'
const DEEP_FILL = '#88888812'
// The speed of the moving status-line meters. To tune on a real screen.
const ANIMATION_MS = 400
// How often the meter steps during the first short wait. Stops after it.
const PRESENT_TICK_MS = 1_000
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const CONNECTION_KEY = 'connection'

// Forgotten when the session ends. Only `Saved` reaches the store.
const waitTimer = createWaitTimer()
const copiedCodes = new Map<string, boolean>()
let catalog: Catalog | undefined
let lastStatus: string | undefined
let lastInput: StatusInput | undefined
let isWorkingNow = false
let frame = 0
let animation: { cancel: () => void } | undefined
let presentTimer: { cancel: () => void } | undefined
let isFirstWaitPending = false
let lastShownPercent: number | undefined
let isPickerOpen = false
let previewIndex: number | undefined
let openDrawer: string | null = 'mine'
let isSettingsOpen = false
let isResetArmed = false
let isPaneOpen = false
let lineOverride: { line: string | undefined } | null = null
let undoTimer: { cancel: () => void } | undefined
let openDocument: DocumentId | null = null
let previewMeter: MeterId | undefined
// Codes shown in full. Emptied when the panel closes; never kept.
const revealedCodes = new Set<string>()

// The two offline documents, and the two shown on the Connect card and while connected.
type DocumentId = 'terms' | 'privacy' | 'connect-terms' | 'connect-privacy'
type Surface = Parameters<EngineInterface['ui']['copy']>[0]['surface']
type Deal = { prize: Prize; onCopy: (surface: Surface) => void }
type Row = { id: string; node: any }
type Drawer = { id: string; label: string; deals: Deal[]; rows?: Row[]; emptyText?: string }

async function loadCatalog($: EngineInterface): Promise<Catalog> {
  catalog ??= parseCatalog(await $.fs.read(`${$.plugin.root}/offers.json`))

  return catalog
}

async function loadSaved($: EngineInterface): Promise<Saved> {
  return readSaved(await $.store.get(STORE_KEY), await $.clock.now())
}

async function loadConsent($: EngineInterface): Promise<ConsentRecord> {
  return readConsent(await $.store.get(CONSENT_KEY))
}

// The two documents travel with the add-on, so they open without a connection.
async function loadDocument($: EngineInterface, id: DocumentId): Promise<string> {
  const text =
    id === 'terms'
      ? await $.fs.read(`${$.plugin.root}/TERMS.md`)
      : id === 'privacy'
        ? await $.fs.read(`${$.plugin.root}/PRIVACY.md`)
        : id === 'connect-terms'
          ? await $.fs.read(`${$.plugin.root}/TERMS-REHEARSAL.md`)
          : await $.fs.read(`${$.plugin.root}/PRIVACY-REHEARSAL.md`)

  return text.replace(/\r/g, '')
}

// The release's end date and trusted keys matter only once the Terms are
// accepted or a Connect press was ever made. Before that the file is not read.
async function loadReleaseIfUsed($: EngineInterface, isAccepted: boolean) {
  if (isAccepted || (await $.store.get(CONNECTION_KEY)) !== undefined || (await $.store.get('codes')) !== undefined) {
    await loadRelease($)
  }
}

// Reads the usage numbers. `rateLimits` is the only part of the answer used.
async function readLimits($: EngineInterface) {
  return (await $.session.usage()).rateLimits
}

// Draws the single status line if its text changed.
function paintStatus($: EngineInterface) {
  if (lineOverride === null && lastInput === undefined) {
    return
  }

  const line = checkLine(lineOverride !== null ? lineOverride.line : statusFor({ ...lastInput!, frame: animation === undefined ? undefined : frame }, lastInput!.display ?? 'ready'))

  if (line !== lastStatus) {
    lastStatus = line
    $.ui.status(line)
  }
}

// Runs the timer only while the tool works and the meter can move. It repaints
// the numbers it already has and reads nothing.
function syncAnimation($: EngineInterface) {
  const shouldMove = isWorkingNow && lastInput !== undefined && canAnimate(lastInput)

  if (shouldMove && animation === undefined) {
    animation = $.clock.every(ANIMATION_MS, () => {
      frame += 1
      paintStatus($)
    })
  }

  if (!shouldMove && animation !== undefined) {
    animation.cancel()
    animation = undefined
    paintStatus($)
  }
}

// Remembers when the invitation was first shown, and finishes a deletion whose
// undo time has passed, even if the session ended during it.
async function settleConsent($: EngineInterface, now: number): Promise<ConsentRecord> {
  const before = await loadConsent($)
  let record = before.status === 'none' ? noteInviteSeen(before, now) : before

  if (shouldDelete(record, now)) {
    await $.store.delete(STORE_KEY)
    record = finishDelete(record)
    copiedCodes.clear()
    isSettingsOpen = false
    openDrawer = 'mine'
    $.ui.invalidate('ui.render')
  }

  if (record !== before) {
    await $.store.set(CONSENT_KEY, record)
  }

  return record
}

// Runs only while a deletion can still be undone.
function syncUndoTimer($: EngineInterface, isPending: boolean) {
  if (isPending && undoTimer === undefined) {
    undoTimer = $.clock.every(PRESENT_TICK_MS, async () => {
      await refreshStatus($)
      $.ui.invalidate('ui.render')
    })
  }

  if (!isPending && undoTimer !== undefined) {
    undoTimer.cancel()
    undoTimer = undefined
  }
}

// Follows the window and redraws the status line.
async function refreshStatus($: EngineInterface) {
  const now = await $.clock.now()
  const consent = await settleConsent($, now)
  const view = viewOf(consent, now)

  await loadReleaseIfUsed($, isRunning(view))
  // Codes past their use-by date are deleted here, whatever else is on or off.
  const codes = await pruneCodes($, now)
  const connection = await loadConnection($)

  lineOverride = consentLine(view, consent, now)
  syncUndoTimer($, consent.deletePending || canUndo(connection, now))

  // Without acceptance: no usage figures, no prizes, no pop-ups, no counting.
  if (!isRunning(view)) {
    lastInput = undefined
    isFirstWaitPending = false
    paintStatus($)
    syncAnimation($)
    syncPresentTimer($)

    return
  }

  const limits = await readLimits($)
  const before = await loadSaved($)
  const { milestones, drops, dailyPresent, defaultMeters } = await loadCatalog($)
  // Once a signed list is in use, the offers and the pop-ups follow it. This
  // reads what is already in memory: a status refresh never uses the network.
  const served = serverView(connection, now)
  const dealt = takePopups(noteMilestones(trackWindow(assignFirstMeter(before, defaultMeters, now), pickFiveHour(limits)), now, milestones), served.kind === 'local' && drops.length > 0 && isDropUnlocked(now))
  const burned = takeBurnouts(dealt.saved, currentWindow(pickFiveHour(limits), now), currentWindow(pickWeekly(limits), now), now)
  let updated = burned.saved
  let popups = [...dealt.popups, ...burned.popups]

  if (served.kind !== 'local') {
    const rules = served.kind === 'live' ? served.catalogue.popupRules : []
    const first = readPopups(await $.store.get(POPUPS_KEY), now)
    let record = first

    // The signed list says how many pop-ups a day; the words are built in.
    popups = burned.popups.filter(() => {
      const taken = takePopup(record, rules, 'limit-lounge')
      record = taken.record

      return taken.isAllowed
    })

    if (served.kind === 'live') {
      const opened = newlyOpen(record, served.catalogue, codes, connection.firstSeenAt, now)
      record = opened.record

      if (opened.count > 0 && updated.meter !== null) {
        const taken = takePopup(record, rules, 'daily-offer')

        if (canPopUp(updated) && taken.isAllowed) {
          record = taken.record
          popups.push(OFFER_POPUP)
        }

        updated = { ...updated, marksPending: updated.marksPending + opened.count }
      }
    }

    if (record !== first) {
      await $.store.set(POPUPS_KEY, record)
    }
  }

  // Prizes arriving while the person is looking at them need no mark.
  const saved = isPaneOpen && openDrawer === 'mine' ? clearMark(updated) : updated

  if (JSON.stringify(saved) !== JSON.stringify(before)) {
    await $.store.set(STORE_KEY, saved)
  }

  popups.filter(isBuiltInPopup).forEach(text => $.ui.toast(text, { timeoutMs: 6000 }))

  if (saved.milestonesSeen.length !== before.milestonesSeen.length) {
    $.ui.invalidate('ui.render')
  }

  lastInput = {
    meter: saved.meter,
    five: pickLimit(limits),
    gifts: saved.marksPending,
    isGoodPace: saved.goodPaceNotice,
    waitedMinutes: saved.minutes,
    now,
    present: presentProgress(saved, now, milestones, dailyPresent),
    display: saved.meterDisplay,
  }

  // Keeps the picture in an open panel in step with the status line.
  const shownPercent = lastInput.present?.percent ?? lastInput.five?.percent

  if (shownPercent !== lastShownPercent) {
    lastShownPercent = shownPercent
    $.ui.invalidate('ui.render')
  }

  isFirstWaitPending = saved.installedAt !== null && nextMilestone(saved, now, milestones) !== undefined
  paintStatus($)
  syncAnimation($)
  syncPresentTimer($)
}

function syncPresentTimer($: EngineInterface) {
  if (isFirstWaitPending && presentTimer === undefined) {
    presentTimer = $.clock.every(PRESENT_TICK_MS, () => refreshStatus($))
  }

  if (!isFirstWaitPending && presentTimer !== undefined) {
    presentTimer.cancel()
    presentTimer = undefined
  }
}

// Codes hide again, and the one-time notes go, when the panel closes or is
// opened afresh.
function hidePaneSecrets() {
  revealedCodes.clear()
  clearOnceNotes()
}

async function changeSaved($: EngineInterface, change: (saved: Saved) => Saved) {
  await $.store.set(STORE_KEY, change(await loadSaved($)))
  await refreshStatus($)
  $.ui.invalidate('ui.render')
}

async function copyCode($: EngineInterface, code: string, surface: Surface, change?: (saved: Saved) => Saved) {
  // Only something that looks like a code ever reaches the clipboard.
  if (!CODE_FORMAT.test(code)) {
    return
  }

  const result = await $.ui.copy({ text: code, surface })
  copiedCodes.set(code, result.isCopied)

  if (change !== undefined && result.isCopied) {
    await changeSaved($, change)
  } else {
    $.ui.invalidate('ui.render')
  }
}

function redraw($: EngineInterface, change: () => void) {
  change()
  $.ui.invalidate('ui.render')
}

async function resetSaved($: EngineInterface) {
  // Deleting saved data also withdraws from the server, with no undo time.
  await disconnectNow($, true)
  await $.store.delete(STORE_KEY)
  await refreshStatus($)
  isResetArmed = false
  isSettingsOpen = false
  isPickerOpen = false
  previewIndex = undefined
  openDrawer = 'mine'
  copiedCodes.clear()
  $.ui.invalidate('ui.render')
}

async function changeConsent($: EngineInterface, change: (record: ConsentRecord, now: number) => ConsentRecord) {
  await $.store.set(CONSENT_KEY, change(await loadConsent($), await $.clock.now()))
  await refreshStatus($)
  $.ui.invalidate('ui.render')
}

function Hairline(t: any, inset: number, key: string) {
  const { Box, Svg } = t

  return (
    <Box key={key}>
      <Svg alt="—" width={inset} height={1} source={blankSvg(inset)} />
      <Box flexGrow={1} minWidth={0} overflow="hidden">
        <Svg alt="—" height={1} source={hairlineSvg()} />
      </Box>
    </Box>
  )
}

// The chosen meter: its wide scene, or its text where drawings cannot show.
function MeterPicture(t: any, id: MeterId, percent: number, hasDrawings: boolean) {
  const { Svg, Text } = t

  return hasDrawings ? <Svg alt={drawMeter(id, percent)} source={loadingSvg(id, percent)} /> : <Text>{drawMeter(id, percent)}</Text>
}

function DealRow(t: any, deal: Deal, colour: string, hasDrawings: boolean) {
  const { Box, Button, Svg, Text } = t
  const { prize, onCopy } = deal
  const copied = copiedCodes.get(prize.code) === true

  return (
    <Box key={`deal-${prize.id}`} gap="sm" alignItems="center" paddingX="sm" paddingY="xs">
      {hasDrawings && <Svg alt={prize.brand} width={34} height={34} source={logoTileSvg(prize.brand)} />}
      <Box flexDirection="column" flexGrow={1} minWidth={0}>
        <Text weight="semibold" size="footnote">{prize.brand}</Text>
        <Text weight="medium" size="caption" color={colour}>{prize.text}</Text>
      </Box>
      <Text mono size="caption" dimColor={!copied} color={copied ? 'success' : undefined}>{prize.code}</Text>
      <Button key={`copy-${prize.id}`} label={copied ? '✓' : '⧉'} onPress={(press: any) => onCopy(press.surface)} />
    </Box>
  )
}

function DrawerRow($: EngineInterface, t: any, drawer: Drawer, hasDrawings: boolean) {
  const { Box, Button, Svg, Text } = t
  const isOpen = openDrawer === drawer.id
  const toggle = () => {
    openDrawer = isOpen ? null : drawer.id

    // The gift mark goes when the prizes are actually in view.
    return (drawer.id === 'mine' || drawer.id === 'day') && !isOpen ? changeSaved($, clearMark) : $.ui.invalidate('ui.render')
  }
  const colour = drawerColour(drawer.id)
  const rows = drawer.rows ?? []

  return (
    <Box key={`drawer-row-${drawer.id}`} flexDirection="column">
      <Box gap="sm" alignItems="center" paddingX="sm" paddingY="xs">
        {hasDrawings && <Svg alt={drawer.label} width={28} height={28} source={iconTileSvg(drawer.id)} />}
        {/* A fixed share for the name, so every count lines up in one column. */}
        <Box width="40%">
          <Button key={`drawer-${drawer.id}`} plain label={hasDrawings ? drawer.label : `${Object.hasOwn(DRAWER_ICONS, drawer.id) ? DRAWER_ICONS[drawer.id] : '🏷'} ${drawer.label}`} onPress={toggle} />
        </Box>
        <Box flexGrow={1} />
        <Text dimColor size="caption">{drawer.deals.length + rows.length}</Text>
        <Button key={`drawer-${drawer.id}-caret`} plain dimColor label={isOpen ? '⌄' : '›'} onPress={toggle} />
      </Box>
      {isOpen && (
        <Box flexDirection="column" backgroundColor={hasDrawings ? DEEP_FILL : undefined}>
          {drawer.deals.length + rows.length === 0 && drawer.emptyText !== undefined && <Box paddingX="sm" paddingY="xs"><Text dimColor size="footnote">{drawer.emptyText}</Text></Box>}
          {rows.flatMap((row, index) => [...(index > 0 && hasDrawings ? [Hairline(t, 56, `row-line-${row.id}`)] : []), row.node])}
          {drawer.deals.flatMap((deal, index) => [
            ...((index > 0 || rows.length > 0) && hasDrawings ? [Hairline(t, 56, `deal-line-${deal.prize.id}`)] : []),
            DealRow(t, deal, colour, hasDrawings),
          ])}
        </Box>
      )}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Reads the saved offer list, if a Connect press was ever made. No network.
    await wakeServerLink($)
    await refreshStatus($)
    // Keeps the time to reset on the line correct while the session is idle.
    $.clock.every(60_000, () => refreshStatus($))
    // The only timer that may lead to a network call, and only after Connect:
    // it looks at the shared schedule and fetches the offer list when it is due.
    $.clock.every(TICK_MS, () => void networkTick($))
    void networkTick($, true)
    await $.command.register({
      name: 'pauzza',
      description: 'Open the Pauzza test prize menu',
      immediate: true,
    })

    return next(e)
  })

  // Opens only because the person asked. Returns no text, so no offer can
  // reach the transcript or the model.
  on('command.run', { command: 'pauzza' }, async $ => {
    isPaneOpen = true
    // Each time the panel is opened, claimed codes start hidden.
    hidePaneSecrets()
    if (isRunning(viewOf(await loadConsent($), await $.clock.now()))) {
      await changeSaved($, s => (openDrawer === 'mine' ? clearMark(s) : s))
    }

    await $.ui.open({ id: PANE, title: PANE_TITLE })

    return {}
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      isPaneOpen = false
      hidePaneSecrets()
    }

    return next(e)
  })

  // Counts waiting time from `isWorking` and the clock, and draws nothing.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!isRunning(viewOf(await loadConsent($), await $.clock.now()))) {
      waitTimer.update(false, 0)

      return next(e)
    }

    const finishedMs = waitTimer.update(e.props.isWorking, await $.clock.now())

    isWorkingNow = e.props.isWorking
    syncAnimation($)

    if (finishedMs !== undefined) {
      const { rewards } = await loadCatalog($)
      await changeSaved($, saved => addWait(saved, finishedMs, rewards))
    }

    return next(e)
  })

  // Numbers only, and the event itself is not read: it is just the signal to
  // look again at the usage figures.
  on('session.measure', async ($, e, next) => {
    await refreshStatus($)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e) as any
    const { Box, Button, Svg, Text } = t
    const hasDrawings = e.surface !== 'terminal' && Svg !== undefined
    const { Link, Markdown } = t
    const consent = await loadConsent($)
    const data = await loadCatalog($)
    const saved = await loadSaved($)
    const now = await $.clock.now()
    const consentView = viewOf(consent, now)
    const running = isRunning(consentView)
    const showDocument = (id: DocumentId | null) => redraw($, () => { openDocument = id })
    await loadReleaseIfUsed($, running)
    const connection = await loadConnection($)
    const codes = await loadCodes($, now)
    const linked = isConnected(connection)

    if (openDocument !== null) {
      const file: DocumentFile | undefined = openDocument === 'terms' ? 'TERMS.md' : openDocument === 'privacy' ? 'PRIVACY.md' : undefined
      const online = hasPublicRepo && file !== undefined ? officialLink(documentUrl(file)) : undefined
      const title = openDocument === 'terms' ? CONSENT_TEXT.terms : openDocument === 'privacy' ? CONSENT_TEXT.privacy : openDocument === 'connect-terms' ? CONNECT_TEXT.terms : CONNECT_TEXT.privacy

      return (
        <Box flexDirection="column" gap="sm">
          <Box gap="sm" alignItems="center">
            <Button key="document-back" plain dimColor label="‹" onPress={() => showDocument(null)} />
            <Text weight="semibold">{title}</Text>
          </Box>
          <Markdown key="document-text" text={await loadDocument($, openDocument)} />
          {online !== undefined && <Link key="document-online" href={online} label={CONSENT_TEXT.openOnline} />}
        </Box>
      )
    }

    const minutes = Math.min(saved.minutes + waitTimer.runningMs(now) / 60_000, DAILY_CAP_MINUTES)
    const five = running ? currentWindow(pickLimit(await readLimits($)), now) : undefined
    const isLounge = isLimited(five)
    const presents = reachedMilestones(saved, now, data.milestones)
    const isFirstTime = saved.meter === null
    const showCarousel = isFirstTime || isPickerOpen
    const chosen = showCarousel ? null : saved.meter
    const present = isLounge ? undefined : presentProgress(saved, now, data.milestones, data.dailyPresent)
    const chosenPercent = isLounge ? 100 : (present?.percent ?? five?.percent)
    const chosenNote =
      present !== undefined
        ? presentNote(present.leftMs)
        : five === undefined
          ? 'No limit data yet'
          : formatReset(five.resetMs, now)

    const previewPercent = five?.percent ?? SAMPLE_PERCENT
    const savedIndex = METERS.findIndex(meter => meter.id === saved.meter)
    const shownIndex = previewIndex ?? Math.max(0, savedIndex)
    const atOffset = (offset: number) => METERS[(shownIndex + offset + METERS.length) % METERS.length]
    // Reads the live position, so quick presses between redraws all count.
    const liveIndex = () => previewIndex ?? Math.max(0, savedIndex)
    const flip = (offset: number) => redraw($, () => { previewIndex = (liveIndex() + offset + METERS.length) % METERS.length })
    const closeCarousel = () => {
      isPickerOpen = false
      previewIndex = undefined
    }
    const choose = (id: MeterId) => {
      closeCarousel()

      return changeSaved($, s => pickMeter(s, id))
    }

    const plainDeal = (prize: Prize, change?: (s: Saved) => Saved): Deal => ({
      prize,
      onCopy: s => copyCode($, prize.code, s, change),
    })
    const extras = [
      saved.finishEarned ? data.finishReward : undefined,
      saved.welcomeEarned ? data.welcomeReward : undefined,
      saved.goodPaceEarned ? data.goodPaceReward : undefined,
      saved.burnFiveEarned ? data.burnFive : undefined,
      hasBurnWeek(saved, now) ? data.burnWeek : undefined,
    ].flatMap(prize => (prize === undefined ? [] : [plainDeal(prize)]))
    const mine = [
      ...[...presents].reverse().map(item => plainDeal(item)),
      ...readyRewards(minutes, data.rewards).map(reward => plainDeal(reward, s => claimReward(s, reward.id))),
      ...extras,
    ]
    const drop = dropOfDay(data.drops, now)
    const dayDeals: Deal[] =
      drop !== undefined && isDropUnlocked(now)
        ? [{ prize: drop, onCopy: s => copyCode($, drop.code, s, x => ({ ...x, dropClaimed: true })) }]
        : []
    const offers = sortOffers(data.offers, [], saved.recent, isLounge)
    const card = hasDrawings ? { borderStyle: 'round', borderColor: CARD_FILL, backgroundColor: CARD_FILL } : { borderStyle: 'round', borderDimColor: true }

    // What came from the server. Everything here was checked on arrival and is
    // read from memory or the saved record: drawing never uses the network.
    const served = running ? serverView(connection, now) : ({ kind: 'local' } as const)
    const isOffline = running && linked && (await isUnreachable($))
    const useByText = (ms: number) => {
      const date = new Date(ms)

      return CONNECT_TEXT.useBy(`${date.getDate()} ${SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}`)
    }
    // A claimed code: hidden each time the panel opens, shown in full on a press.
    const codeRow = (item: StoredCode): Row => {
      const isShown = revealedCodes.has(item.claimId)
      const copied = copiedCodes.get(item.code) === true

      return {
        id: `code-${item.claimId}`,
        node: (
          <Box key={`code-${item.claimId}`} gap="sm" alignItems="center" paddingX="sm" paddingY="xs" flexWrap="wrap">
            {hasDrawings && <Svg alt={item.brand} width={34} height={34} source={logoTileSvg(item.brand)} />}
            <Box flexDirection="column" flexGrow={1} minWidth={0}>
              <Text weight="semibold" size="footnote">{item.brand}</Text>
              <Text weight="medium" size="caption">{item.text}</Text>
              <Text dimColor size="caption">{useByText(item.useBy)}</Text>
            </Box>
            {isShown ? <Text mono bold size="caption" color="warning">{item.code}</Text> : <Text mono dimColor size="caption">{maskCode(item.code)}</Text>}
            <Button key={`reveal-${item.claimId}`} plain label={isShown ? CONNECT_TEXT.hide : CONNECT_TEXT.show} onPress={() => redraw($, () => { isShown ? revealedCodes.delete(item.claimId) : revealedCodes.add(item.claimId) })} />
            <Button key={`copy-${item.claimId}`} plain label={copied ? CONNECT_TEXT.copied : CONNECT_TEXT.copy} onPress={(press: any) => copyCode($, item.code, press.surface)} />
          </Box>
        ),
      }
    }
    // An offer with no code yet. One press on "Get code" asks the server once.
    const offerRow = (offer: ServerOffer, catalogue: Catalogue, isOpen: boolean): Row => {
      const note = claimNote(offer.campaign.id, now)
      const host = offer.link === undefined ? undefined : checkLink(offer.link, catalogue.allowedLinkHosts)
      const href = host === undefined ? undefined : offerLink(offer.id)
      const getCode = async () => {
        const got = await claimOffer($, offer)

        // Shown in full once, right after the press.
        if (got !== undefined) {
          revealedCodes.add(got.claimId)
        }

        await refreshStatus($)
        $.ui.invalidate('ui.render')
      }
      const quiet = note === 'getting' ? CONNECT_TEXT.gettingCode : note === 'none-left' ? CONNECT_TEXT.noneLeft : note === 'unavailable' || !isOpen ? CONNECT_TEXT.unavailable : undefined
      const isDim = quiet !== undefined && note !== 'getting'

      return {
        id: `offer-${offer.id}`,
        node: (
          <Box key={`offer-${offer.id}`} gap="sm" alignItems="center" paddingX="sm" paddingY="xs" flexWrap="wrap">
            {hasDrawings && <Svg alt={offer.brand} width={34} height={34} source={logoTileSvg(offer.brand)} />}
            <Box flexDirection="column" flexGrow={1} minWidth={0}>
              <Text weight="semibold" size="footnote" dimColor={isDim}>{offer.brand}</Text>
              <Text weight="medium" size="caption" dimColor={isDim}>{offer.text}</Text>
              {href !== undefined && host !== undefined && Link !== undefined && <Link key={`link-${offer.id}`} href={href} label={host} />}
            </Box>
            <Text mono dimColor size="caption">{CONNECT_TEXT.hiddenCode}</Text>
            {quiet === undefined && note === 'offline' && <Text dimColor size="caption">{CONNECT_TEXT.claimOffline}</Text>}
            {quiet !== undefined ? <Text dimColor size="caption">{quiet}</Text> : <Button key={`claim-${offer.id}`} label={CONNECT_TEXT.getCode} onPress={getCode} />}
          </Box>
        ),
      }
    }
    const servedDrawers: Drawer[] =
      served.kind !== 'live'
        ? []
        : served.catalogue.categories
            .map(category => ({
              id: category.id,
              label: category.label,
              deals: [],
              rows: served.catalogue.offers
                .filter(offer => offer.category === category.id)
                .flatMap(offer => {
                  const state = offerState(offer, codes, connection.firstSeenAt, now)
                  const held = codes.find(item => item.campaignId === offer.campaign.id)

                  return state === 'ended' ? [] : held !== undefined ? [codeRow(held)] : [offerRow(offer, served.catalogue, state === 'open')]
                }),
            }))
            .filter(drawer => drawer.rows.length > 0)
    const mineDrawer: Drawer = { id: 'mine', label: 'Mine', deals: mine, rows: codes.map(codeRow), emptyText: 'Your presents show up here' }
    const drawers: Drawer[] =
      served.kind !== 'local'
        ? [mineDrawer, ...servedDrawers]
        : [
            mineDrawer,
            { id: 'day', label: 'Daily Drop', deals: dayDeals, emptyText: 'Opens at 12:00' },
            ...data.categories.map(category => ({
              id: category.id,
              label: category.label,
              deals: offers
                .filter(offer => offer.category === category.id)
                .map(offer => ({ prize: offer, onCopy: (s: Surface) => copyCode($, offer.code, s, x => noteCopied(x, offer.id)) })),
            })),
          ]
    const hasNoOffers = served.kind !== 'local' && servedDrawers.length === 0
    const hasUnclaimed = servedDrawers.some(drawer => (drawer.rows ?? []).some(row => row.id.startsWith('offer-')))
    const afterConnection = async () => {
      await refreshStatus($)
      $.ui.invalidate('ui.render')
    }
    const undoSwitchOff = async () => {
      await undoDisconnectNow($)
      await afterConnection()
    }
    const isUndoable = canUndo(connection, now)
    const undoBlock = (
      <Box flexDirection="column" flexGrow={1} minWidth={0}>
        <Text weight="medium">{CONNECT_TEXT.disconnected}</Text>
        <Text dimColor size="caption">{CONNECT_TEXT.offersStopped}</Text>
        <Text dimColor size="caption">{CONNECT_TEXT.deletingIn(connectionUndoSecondsLeft(connection, now))}</Text>
      </Box>
    )
    const acceptNow = async () => {
      // Undoing "Pauzza is on" also undoes the disconnect it caused, if nothing was sent yet.
      await undoDisconnectNow($)
      await $.store.set(STORE_KEY, assignFirstMeter(await loadSaved($), previewMeter === undefined ? [] : [previewMeter], await $.clock.now()))
      await changeConsent($, (record, at) => accept(record, at))
    }
    const documentLinks = (
      <Box gap="xs" alignItems="center" flexWrap="wrap">
        <Button key="open-terms" plain label={CONSENT_TEXT.terms} onPress={() => showDocument(linked ? 'connect-terms' : 'terms')} />
        <Text dimColor size="caption">·</Text>
        <Button key="open-privacy" plain label={CONSENT_TEXT.privacy} onPress={() => showDocument(linked ? 'connect-privacy' : 'privacy')} />
      </Box>
    )
    const tickRow = (label: string, onLater: (() => unknown) | undefined) => (
      <Box justifyContent="space-between" alignItems="center" gap="sm" flexWrap="wrap">
        <Button key="consent-tick" variant="primary" label={label} onPress={acceptNow} />
        {onLater !== undefined && <Button key="consent-later" plain label={CONSENT_TEXT.later} onPress={onLater} />}
      </Box>
    )
    const smallPrint = (
      <Box flexDirection="column">
        <Text dimColor size="caption">{CONSENT_TEXT.age}</Text>
        <Box gap="xs" alignItems="center" flexWrap="wrap">
          {documentLinks}
          <Text dimColor size="caption">· {CONSENT_TEXT.cancelIn}</Text>
        </Box>
      </Box>
    )
    const updateBlock = (
      <Box flexDirection="column" gap="xs">
        <Text weight="semibold" size="footnote">{CONSENT_TEXT.updated}</Text>
        {TERMS_CHANGE_NOTE !== '' && <Text dimColor size="caption">{TERMS_CHANGE_NOTE}</Text>}
        {tickRow(CONSENT_TEXT.updateTick, consent.dismissedTermsVersion === null ? () => changeConsent($, record => dismissUpdate(record)) : undefined)}
        {smallPrint}
      </Box>
    )

    if (isSettingsOpen && saved.meter !== null && (running || consent.deletePending || consentView === 'update-required')) {
      const chooserFill = hasDrawings ? { borderStyle: 'round', borderColor: CARD_FILL, backgroundColor: CARD_FILL } : {}
      const tile = (id: string, label: string) => hasDrawings && <Svg alt={label} width={28} height={28} source={iconTileSvg(id)} />
      const choiceBar = (keyPrefix: string, choices: ReadonlyArray<{ id: string; label: string; isOn: boolean; onPress: () => unknown }>, shouldFill: boolean) => (
        <Box gap="xs" paddingX="xs" flexWrap="wrap" minWidth={0} flexGrow={shouldFill ? 1 : undefined} {...chooserFill}>
          {choices.map(choice => (
            <Box key={`${keyPrefix}-box-${choice.id}`} flexGrow={shouldFill ? 1 : undefined} justifyContent="center">
              {choice.isOn
                ? <Button key={`${keyPrefix}-${choice.id}`} variant="primary" label={choice.label} onPress={choice.onPress} />
                : <Button key={`${keyPrefix}-${choice.id}`} plain dimColor label={choice.label} onPress={choice.onPress} />}
            </Box>
          ))}
        </Box>
      )

      return (
        <Box flexDirection="column" gap="sm">
          <Box gap="sm" alignItems="center">
            <Button key="settings-back" plain dimColor label="‹" onPress={() => redraw($, () => { isSettingsOpen = false; isResetArmed = false })} />
            <Text weight="semibold">Settings</Text>
          </Box>

          <Box flexDirection="column" paddingY="xs" {...card}>
            <Box gap="sm" alignItems="center" paddingX="sm" paddingY="xs">
              {tile('line', 'line')}
              <Text weight="medium">Line under the chat</Text>
            </Box>
            <Box paddingX="sm" paddingBottom="xs">
              {choiceBar('display', DISPLAY_CHOICES.map(([value, label]) => ({ id: value, label, isOn: saved.meterDisplay === value, onPress: () => changeSaved($, s => ({ ...s, meterDisplay: value })) })), true)}
            </Box>
            {hasDrawings && Hairline(t, 52, 'settings-line-1')}
            <Box gap="sm" alignItems="center" paddingX="sm" paddingY="xs">
              {tile('pop', 'pop-ups')}
              <Text weight="medium">Pop-ups</Text>
              {saved.meterDisplay === 'off' && <Box flexGrow={1} />}
              {saved.meterDisplay === 'off' && <Text dimColor size="caption">Off with the line</Text>}
            </Box>
            {saved.meterDisplay !== 'off' && (
              <Box paddingX="sm" paddingBottom="xs">
                {choiceBar('popups', [
                  { id: 'on', label: 'On', isOn: saved.popupsOn, onPress: () => changeSaved($, s => ({ ...s, popupsOn: true })) },
                  { id: 'off', label: 'Off', isOn: !saved.popupsOn, onPress: () => changeSaved($, s => ({ ...s, popupsOn: false })) },
                ], true)}
              </Box>
            )}
          </Box>

          <Box flexDirection="column" paddingY="xs" {...card}>
            <Box gap="sm" alignItems="center" paddingX="sm" paddingY="xs">
              {tile('line', 'acceptance')}
              {consent.deletePending ? (
                <Box flexDirection="column" flexGrow={1} minWidth={0}>
                  <Text weight="medium">{CONSENT_TEXT.stoppedNow}</Text>
                  <Text dimColor size="caption">{CONSENT_TEXT.deletingIn(undoSecondsLeft(consent, now))}</Text>
                </Box>
              ) : (
                <Box flexDirection="column" flexGrow={1} minWidth={0}>
                  <Button key="consent-untick" plain label={CONSENT_TEXT.settingOn} onPress={async () => { await disconnectNow($); await changeConsent($, (record, at) => withdraw(record, at)) }} />
                  <Text dimColor size="caption">{CONSENT_TEXT.settingWarn}</Text>
                  {linked && <Text dimColor size="caption">{CONNECT_TEXT.alsoDisconnects}</Text>}
                  {documentLinks}
                  {linked && connection.publicRef !== null && <Text dimColor size="caption">{CONNECT_TEXT.reference} · {connection.publicRef}</Text>}
                  {linked && connection.publicRef !== null && <Text dimColor size="caption">{CONNECT_TEXT.referenceNote}</Text>}
                </Box>
              )}
              {consent.deletePending && <Button key="consent-undo" label={CONSENT_TEXT.undo} onPress={acceptNow} />}
            </Box>
            {hasDrawings && Hairline(t, 52, 'settings-line-consent')}
            <Box gap="sm" alignItems="center" paddingX="sm" paddingY="xs">
              {tile('trash', 'delete')}
              {!isResetArmed && <Text weight="medium">Saved data</Text>}
              {isResetArmed && <Text weight="semibold" color="error">Really delete?</Text>}
              <Box flexGrow={1} />
              {!isResetArmed && <Button key="reset" onPress={() => redraw($, () => { isResetArmed = true })}><Text color="error">Delete</Text></Button>}
              {isResetArmed && <Button key="reset-cancel" label="No" onPress={() => redraw($, () => { isResetArmed = false })} />}
              {isResetArmed && <Button key="reset-confirm" onPress={() => resetSaved($)}><Text color="error">Yes, delete</Text></Button>}
            </Box>
            {linked && <Box paddingX="sm" paddingBottom="xs"><Text dimColor size="caption">{CONNECT_TEXT.alsoDisconnects}</Text></Box>}
          </Box>
        </Box>
      )
    }

    if (!running) {
      previewMeter ??= saved.meter ?? data.defaultMeters[now % Math.max(data.defaultMeters.length, 1)]
      const shownMeter = METERS.find(meter => meter.id === previewMeter)
      const isUpdate = consentView === 'update-required'
      const note = consentView === 'declined' ? CONSENT_TEXT.declined : consentView === 'withdrawn' ? CONSENT_TEXT.stopped : CONSENT_TEXT.what
      const quietRows = [{ id: 'mine', label: 'Mine' }, { id: 'day', label: 'Daily Drop' }, ...data.categories]

      return (
        <Box flexDirection="column" gap="sm">
          <Box flexDirection="column" gap="xs" paddingX="md" paddingY="sm" {...card}>
            <Box justifyContent="space-between" alignItems="center" gap="sm">
              {shownMeter !== undefined && <Text weight="semibold">{shownMeter.name}</Text>}
              {isUpdate && <Button key="settings-toggle" plain dimColor label="⚙" onPress={() => redraw($, () => { isSettingsOpen = true; isResetArmed = false })} />}
            </Box>
            {shownMeter !== undefined && MeterPicture(t, shownMeter.id, 0, hasDrawings)}
            {isUpdate ? updateBlock : (
              <Box flexDirection="column" gap="xs">
                <Text dimColor size="caption">{note}</Text>
                {hasDrawings && Hairline(t, 1, 'consent-line')}
                {tickRow(CONSENT_TEXT.tick, consentView === 'ask' ? () => changeConsent($, (record, at) => decline(record, at)) : undefined)}
                {smallPrint}
              </Box>
            )}
          </Box>
          {codes.length > 0 && (
            <Box flexDirection="column" paddingY="xs" {...card}>
              <Box paddingX="sm" paddingY="xs"><Text weight="semibold" size="footnote">{CONNECT_TEXT.yourCodes}</Text></Box>
              {codes.map(item => codeRow(item).node)}
            </Box>
          )}
          <Box flexDirection="column" paddingY="xs" {...card}>
            {quietRows.flatMap((row, index) => [
              ...(index > 0 && hasDrawings ? [Hairline(t, 52, `quiet-line-${row.id}`)] : []),
              <Box key={`quiet-${row.id}`} gap="sm" alignItems="center" paddingX="sm" paddingY="xs">
                {hasDrawings && <Svg alt={row.label} width={28} height={28} source={fadedSvg(iconTileSvg(row.id))} />}
                <Text dimColor>{row.label}</Text>
              </Box>,
            ])}
          </Box>
        </Box>
      )
    }

    // The Connect step. Shown only after the Terms are accepted, and never
    // while the wording is unfinished or the test is over.
    const connectNote = currentConnectNote()
    const isConnecting = connectNote === 'connecting'
    const mayConnect = canOfferConnect(now)
    const showConnectCard = !linked && mayConnect && !isUndoable
    const disconnectLine = currentDisconnectNote() === 'done' ? CONNECT_TEXT.disconnectedDone : connection.withdrawal !== null && !isUndoable ? CONNECT_TEXT.disconnectedQueued : undefined
    const connectArea = linked ? (
      connectNote === 'connected' && (
        <Box flexDirection="column" gap="xs" paddingX="md" paddingY="sm" {...card}>
          <Box justifyContent="space-between" alignItems="center" gap="sm">
            <Text weight="semibold" size="footnote">{CONNECT_TEXT.connectedTitle}</Text>
            <Text dimColor size="caption">{isOffline ? CONNECT_TEXT.statusOffline : CONNECT_TEXT.statusConnected}</Text>
          </Box>
          <Text dimColor size="caption">{CONNECT_TEXT.connectedNote}</Text>
        </Box>
      )
    ) : (
      <Box flexDirection="column" gap="xs">
        {disconnectLine !== undefined && <Text dimColor size="caption">{disconnectLine}</Text>}
        {isUndoable && (
          <Box gap="sm" alignItems="center" paddingX="md" paddingY="xs" flexWrap="wrap" {...card}>
            {undoBlock}
            <Button key="connection-undo" label={CONNECT_TEXT.undo} onPress={undoSwitchOff} />
          </Box>
        )}
        {showConnectCard && connectNote === 'failed' && <Text dimColor size="caption">{CONNECT_TEXT.connectFailed}</Text>}
        {/* The same light weight as the acceptance step: one sentence, one button, one line. */}
        {showConnectCard && (
          <Box flexDirection="column" gap="xs" paddingX="md" paddingY="sm" {...card}>
            <Text dimColor size="caption">{CONNECT_TEXT.what}</Text>
            {isConnecting ? (
              <Text dimColor>{CONNECT_TEXT.connecting}</Text>
            ) : (
              <Box alignItems="center" gap="sm" flexWrap="wrap">
                <Button key="connect-press" variant="primary" label={CONNECT_TEXT.connect} onPress={async () => { await connectNow($); await afterConnection() }} />
              </Box>
            )}
            <Box gap="xs" alignItems="center" flexWrap="wrap">
              <Text dimColor size="caption">{CONNECT_TEXT.acceptStart}</Text>
              <Button key="connect-terms" plain label={CONNECT_TEXT.terms} onPress={() => showDocument('connect-terms')} />
              <Text dimColor size="caption">{CONNECT_TEXT.acceptMiddle}</Text>
              <Button key="connect-privacy" plain label={CONNECT_TEXT.privacy} onPress={() => showDocument('connect-privacy')} />
              <Text dimColor size="caption">{CONNECT_TEXT.acceptEnd}</Text>
            </Box>
          </Box>
        )}
      </Box>
    )

    return (
      <Box flexDirection="column" gap="sm">
        {consentView === 'update-notice' && <Box paddingX="md" paddingY="sm" {...card}>{updateBlock}</Box>}
        {isLounge && <Text bold color="warning">🛋 Limit Lounge: best offers first</Text>}

        {showCarousel && (
          <Box flexDirection="column" gap="sm" alignItems="center" paddingX="md" paddingY="sm" {...card}>
            {isFirstTime && <Text weight="semibold" size="heading">Choose your meter</Text>}
            {isFirstTime && <Text dimColor size="caption">Your first pick comes with a present</Text>}
            {five === undefined && <Text dimColor size="caption">Sample: no limit data yet</Text>}
            <Text weight="semibold">{atOffset(0).name}</Text>
            <Box gap="sm" alignItems="center" justifyContent="center">
              <Button key="carousel-prev" plain dimColor label="‹" onPress={() => flip(-1)} />
              {hasDrawings && <Svg alt={atOffset(-1).name} width={57} height={35} source={fadedSvg(loadingTileSvg(atOffset(-1).id, previewPercent))} />}
              {hasDrawings ? (
                <Svg alt={atOffset(0).name} width={146} height={90} source={loadingTileSvg(atOffset(0).id, previewPercent)} />
              ) : (
                <Text>{drawMeter(atOffset(0).id, previewPercent)}</Text>
              )}
              {hasDrawings && <Svg alt={atOffset(1).name} width={57} height={35} source={fadedSvg(loadingTileSvg(atOffset(1).id, previewPercent))} />}
              <Button key="carousel-next" plain dimColor label="›" onPress={() => flip(1)} />
            </Box>
            {hasDrawings ? <Svg alt={`${shownIndex + 1}/${METERS.length}`} width={dotsWidth(METERS.length)} height={6} source={dotsSvg(METERS.length, shownIndex)} /> : <Text dimColor>{METERS.map((_, i) => (i === shownIndex ? '●' : '○')).join(' ')}</Text>}
            <Box gap="sm" justifyContent="flex-end" alignItems="center" alignSelf="flex-end">
              {!isFirstTime && <Button key="carousel-cancel" plain dimColor label="Cancel" onPress={() => redraw($, closeCarousel)} />}
              <Button key="carousel-choose" variant="primary" label="Choose" onPress={() => choose(METERS[liveIndex()].id)} />
            </Box>
          </Box>
        )}

        {chosen !== null && (
          <Box flexDirection="column" gap="xs" paddingX="md" paddingY="sm" {...card}>
            <Box justifyContent="space-between" alignItems="center" gap="sm">
              <Text weight="semibold">{METERS.find(meter => meter.id === chosen)?.name}</Text>
              <Box gap="md" alignItems="center">
                <Button key="meter-change" plain dimColor label="Change" onPress={() => redraw($, () => { isPickerOpen = true })} />
                <Button key="settings-toggle" plain dimColor label="⚙" onPress={() => redraw($, () => { isSettingsOpen = true; isResetArmed = false })} />
              </Box>
            </Box>
            {MeterPicture(t, chosen, chosenPercent ?? 0, hasDrawings)}
            <Box gap="sm" alignItems="flex-end" justifyContent="space-between">
              {chosenPercent !== undefined && hasDrawings && <Text bold size="title">{Math.round(chosenPercent)}%</Text>}
              <Text dimColor size="caption">{chosenNote}</Text>
            </Box>
          </Box>
        )}

        {connectArea}

        {isOffline && <Text dimColor size="caption">{served.kind === 'local' ? CONNECT_TEXT.offlineSamples : CONNECT_TEXT.offlineList}</Text>}
        <Text dimColor size="caption">{served.kind === 'local' ? CONSENT_TEXT.samples : CONNECT_TEXT.testCodes}</Text>
        {hasUnclaimed && <Text dimColor size="caption">{CONNECT_TEXT.getCodeNote}</Text>}
        {hasNoOffers && (
          <Box flexDirection="column">
            <Text size="footnote">{CONNECT_TEXT.noOffers}</Text>
            <Text dimColor size="caption">{CONNECT_TEXT.noOffersNote}</Text>
          </Box>
        )}

        <Box flexDirection="column" {...card}>
          {drawers.flatMap((drawer, index) => [
            ...(index > 0 && hasDrawings ? [Hairline(t, 52, `line-${drawer.id}`)] : []),
            DrawerRow($, t, drawer, hasDrawings),
          ])}
        </Box>
      </Box>
    )
  })
}
