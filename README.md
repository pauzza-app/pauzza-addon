# Pauzza

Version 0.21.0. A small terminal-style meter sits on the status line, and typing `/pauzza` opens a panel of offers and promo codes. Before you press Connect, the panel shows built-in samples, such as "Test Pizza" with code TEST-0001, which work at no shop.

New in 0.20.0, simplified in 0.20.1 and 0.20.2: a separate **Connect** step. Until you press "Connect", the add-on sends nothing and works from its built-in samples, exactly as before. After it, offers and promo codes come from Pauzza's server.

New in 0.21.0: once connected, only the offers in Pauzza's signed list show; the practice prizes stay for the time before "Connect". The signed list can put an offer in a special place: the daily offer, a prize for reaching the 5-hour or the weekly usage limit, or a present some time after connecting. It can also group offers in a campaign, such as Black Friday. A line under the drawers says when a newer Pauzza is out. This version asks for the list at a new address, `catalogue2`, and reads only the new list format; a list saved by 0.20.2 is not used.

## The official copy

The only official copy is `https://github.com/pauzza-app/pauzza-addon`, and it is installed only through `pauzza-app/pauzza-marketplace`. Do not install Pauzza from anywhere else.

Pauzza never asks for your card details or passwords, and never asks you to run a command to claim a prize. If something using the Pauzza name does, it is not us.

## Connecting to Pauzza's server (version 0.21.0)

### Before you press "Connect"

Nothing is sent: not the offer list, not a check for updates, nothing. Nothing runs either: no usage figure is read and nothing is counted. Accepting the Terms and connecting are one press. A test proves this for every screen.

The first `/pauzza` shows the Connect card below the meter: "Connect to Pauzza to get offers and promo codes from partner shops. Pauzza never reads your code, prompts or conversations." and "Your usage figures stay on your computer.", one `Connect` button with `Not now` beside it, and one line under it, "By connecting you accept the Terms and Privacy Policy and confirm you are 18 or older.", where `Terms` and `Privacy Policy` open the two documents inside the panel. One press accepts the Terms and Privacy Policy, confirms your age, and connects. The button is not chosen for you, so a stray Enter does not connect. `Not now` declines: nothing runs and nothing is sent, and the same button stays for later. If the connection fails, your acceptance stands, Pauzza works from its built-in samples, and the card offers `Connect` again, without `Not now`: closing the panel is enough.

With no end date in `release.json` (the key left out, or `""`), Connect is offered and nothing ends by a date. With a real date it is not offered after that day. While the value is anything else, such as a placeholder, it is not offered at all.

### When the texts change

Your Connect press covers the wording, Terms and Privacy Policy that were on the card. If a newer Pauzza ships other versions of any of them, it no longer counts as connected: it fetches no offers, and `Get code` is gone. The panel is back to the built-in samples, as before "Connect", and the server pop-ups and the update line stop. At the next start, before anything else, it asks the server to delete your old install record, with no undo time. If the server cannot be reached, that request keeps being retried, with longer and longer waits, and goes first at the next start; nothing else is sent meanwhile. The Connect card comes back with one extra line: "The texts have changed. To keep getting offers, read them and press Connect again. Codes you already have stay until their use-by date." Codes you already claimed stay under `Mine`. Pressing `Connect` makes a new install under the new texts. Closing the panel leaves you disconnected, and the card asks again the next time you open `/pauzza`.

If you connected under the new texts in a newer Pauzza while another window still runs this version, that window does not touch the new connection: it sends nothing, shows no offers and no Connect card, and its panel says "A newer Pauzza is out. Type /reload-plugins. If nothing changes, update it in /plugin first." Switching Pauzza off there still disconnects it.

### What is sent, and when

Every request goes to one address fixed in this version, `https://pwchzyltlirhiiaxoifb.supabase.co/functions/v1/`. No address is ever taken from a reply.

| When | What is sent | What is not |
| --- | --- | --- |
| You press `Connect` | The versions of the wording, Terms and Privacy Policy that were on screen, and the add-on's version | No identifier of any kind. The server makes a random number for your install and sends it back |
| Every 4 to 5 hours while connected, at a random moment, and when you press `Try now` or `Check now` (together at most once every 30 seconds) | A plain request for the signed offer list, at `…/functions/v1/catalogue2` | No install number, no token, no cookie, and nothing from an earlier reply. The request is the same for everyone |
| You press `Get code` | The install's token, the offer's id, and a random key so that a repeated press cannot take two codes | Nothing else |
| You press `Get code` on a 5-hour or weekly limit prize | The same as any `Get code`. Because the offer is a limit prize, the server can tell you reached that usage limit at least once that day or week | Your usage numbers, when you reached the limit, or how often |
| You disconnect, switch Pauzza off, or delete saved data, or the texts you accepted at Connect have changed | The install's token and the three versions, so the server deletes your install record | Nothing else |

Like any internet request, each one shows the server your IP address.

Never sent, in any request: your code, prompts or conversations, file or folder names, your usage percentages, your waiting time, which meter you chose, or anything typed after `/pauzza`.

The offer list is fetched on a shared schedule: at most every few hours, spread at random, with longer and longer waits after a failure (15 minutes, 30 minutes, 1 hour, up to a day). It is never fetched when the panel is drawn, when the line under the chat refreshes, or at 12:00. When the server cannot be reached, the panel shows a `Try now` button. While connected, ⚙ also shows when the offers were last checked, with a `Check now` button, so a new list can be fetched at once. Either press fetches the list once, at most once every 30 seconds between them. A failed press does not change those waits, and a successful one ends them as any successful fetch does.

### What the add-on does with what comes back

- **The offer list must be signed.** It is checked on your computer against public keys shipped in `release.json`. A list with a bad or missing signature, an unknown field, a wrong type, text outside plain English letters, digits and listed punctuation, a web address written into the text (such as `pizza.ge`), a link outside the signed host list, or a size over 256 KB is refused whole, silently. So is a list older than the newest one this computer has accepted, even after a disconnect, and one past its own end date. The last good list stays for up to 14 days; after that, or if none was ever received, the built-in samples show.
- **A code must look like a code:** capitals and digits with at most one dash. Anything else is thrown away and never reaches the screen or the clipboard.
- **The server decides** whether a code is given. The add-on only shows what should be ready.
- **Only the new list format.** This version asks for the list at `catalogue2` and accepts only its format (format 2). A list in the older format, such as one saved by 0.20.2, is refused, and no offers show until the next list arrives. The list names where an offer shows (the daily offer, a limit prize or a present) and the campaigns, from fixed sets built into the add-on; an unknown name refuses the whole list.
- **Pop-ups come from built-in lines.** The signed list can say how many a day, never the words. A campaign's pop-up is its look's own fixed line, such as `🖤 Black Friday deals are on · /pauzza`, whatever the campaign is called. The newest version number in the list is a number only; the update line and pop-up are built in.
- **Slow, failed or oversized replies** count as no reply. The panel says so calmly and the samples keep working.
- **Every reply is checked before it is used.** An offer list must carry Pauzza's signature and a code must have the expected shape, or it is ignored. The add-on asks one address only; if that server ever redirected a request, the tool itself could follow the redirect, which the add-on cannot switch off, and the reply would still have to pass these checks.

### Codes

`Get code` asks the server once. It stays pressable when the add-on thinks it is offline: a press tries the server, and says `Can't reach Pauzza right now.` if that fails. The code shows in full once, then is hidden each time the panel opens (`••••••-0042`) until you press `Show`. `Copy` works while it is hidden. Claimed codes are under `Mine`. Each is deleted from your computer at its use-by date.

### How to disconnect

Open `/pauzza`, press ⚙, press `☑ Pauzza is on`. There is one switch: it stops Pauzza and disconnects it. Offers stop at once. For 10 seconds you can press `Undo`; nothing has been sent yet. Then the add-on asks the server to delete your install record. If the server cannot be reached, the request waits and goes out before anything else at the next start. Codes you already claimed stay until their use-by date.

`Delete` next to "Saved data" also disconnects, at once, with no undo time.

A newer Pauzza whose Connect texts have changed also disconnects by itself, at once, with no undo time, and shows the Connect card again (see "When the texts change" above).

This version has no end date (`release.json` holds none). A build with an end date disconnects by itself after it, deletes the offer list and the codes it received, and stops contacting the server.

A window still running this version after its end date leaves alone a connection made by a newer Pauzza in another window, under that Pauzza's own texts: its codes, offer list and other saved values stay, for the newer Pauzza to show. That window shows none of them, only the line saying a newer Pauzza is out.

### What the server keeps, and for how long

In short; the full text is the Privacy Policy, `PRIVACY.md`, which the Connect card opens.

| Kept on the server | Until |
| --- | --- |
| A random number for your install, a short reference shown in ⚙, when you connected, when you last claimed a code, the add-on's version | You disconnect |
| The codes you claimed, and when | As long as needed for the offer and its limits, as the Privacy Policy says |
| A record that you connected and disconnected, and which wording you saw | 1 year |
| Your IP address in the host's technical logs | A few days, as the Privacy Policy says |

The server never receives your code, prompts, conversations, usage figures or waiting time.

### After Connect: only the signed offers

- **No practice prizes.** Once connected, the pretend rewards, presents, limit prizes, Daily Drop and sample categories from `offers.json` no longer show, and earn no marks or pop-ups. If no signed list is in hand, the panel says `No offers right now`. Before "Connect" nothing changes.
- **Daily offer.** A drawer named `Daily offer` shows the day's daily offer from 12:00 Tbilisi time until 12:00 the next day. Before 12:00 it shows the earlier one while it is still open, or `Opens at 12:00`. On a day with no daily offer the drawer is hidden. `A new offer is open · /pauzza` pops up once when it opens.
- **Limit prizes.** Once this computer has seen 100% on the 5-hour limit (for the rest of that day) or the weekly limit (until the weekly window resets), the first prize offer still available shows under `Mine`, with the line `Getting this code tells Pauzza you reached a usage limit today.` (or `this week`). One is shown per period. A limit prize never shows a shop link, because opening it would tell the shop that you reached a usage limit, without the line that `Get code` shows. With no prize offer, or none left, nothing appears: no row, no mark and no pop-up. Its pop-up shows only when a real prize is waiting, pop-ups are on and the signed list allows it.
- **Presents.** Presents are steps by time since connecting. A ready one shows under `Mine`, and the meter counts down to the next step. With no presents in the list there is no present bar.
- **No codes left.** An offer whose codes ran out says `No codes left`. For a limit prize, the next one in its place takes over, and when none is left the prize goes.
- **Campaigns.** The campaign drawer shows the campaign's name and last day, such as `🖤 Black Friday · until 1 Dec`, in the look's colour and icon, and starts open. Its offers leave their usual category while it runs, and go back when it ends. When none is left to show, it says `You have seen all Black Friday offers`. One pop-up, the look's own line, comes when a campaign starts, if one of its offers is open.
- **News.** A signed list can carry a news rule: `Something new in Pauzza · /pauzza` pops up once for that list.
- **Updates.** When the signed list names a newer Pauzza, a line under the drawers says how to get it, and one pop-up says so once for each newer version. Neither comes back after the update.
- **One pop-up at a time.** At most one pop-up shows at each check, the most important first: a limit prize, a campaign's start, a new offer, news, then a newer version. The others wait for a later check; none is dropped for waiting. Each needs pop-ups on and a chosen meter.

### Updating

Updates from the Pauzza marketplace do not arrive by themselves unless you switch on auto-update: `/plugin` → Marketplaces → pauzza → Enable auto-update. Pauzza cannot switch it on for you; ⚙ in `/pauzza` says the same under "Automatic updates". With it on, the tool fetches updates itself and then asks you to type `/reload-plugins`.

Without auto-update: `/plugin` → Marketplaces → pauzza → Update, or in a shell `claude plugin update pauzza@pauzza`, then `/reload-plugins` or a new session. If an update has already been downloaded, `/reload-plugins` alone is enough.

## What it does

- **Campaigns (version 0.21.0).** During a campaign, its offers are grouped in a highlighted drawer at the top.
- **English only (version 0.19.0).** Every label, button, status line, pop-up, sample offer and both documents are in English. Nothing you saved changes, and nobody is asked to accept again: the Terms themselves are the same, only the language of the screen changed.

- **The line under the chat box.** Three settings under ⚙: always show the meter, only when something is ready (the default, such as `🎁 1 · /pauzza`), or off. Changing it needs no reload. Until you choose a meter, the line asks you to.
- **Meter on the status line.** Pick one of five in `/pauzza`. It follows your 5-hour usage limit, ends in the percentage and shows the time to reset, such as `ln 22 ─────>┄┄┄┄● 52% ↻2h 24m`. The line stays text; the drawings are only inside `/pauzza`.
- **The five terminal meters (Loadings v2).** Each fills as the number rises and has a drawing in the panel and a text form on the line:

  | Meter | The idea | On the line at 52% |
  | --- | --- | --- |
  | `line 42` | A cursor walks down an editor's line numbers to line 42, where the red breakpoint dot waits. At 100% the line is highlighted and reads `take a break;`. | `ln 22 ─────>┄┄┄┄● 52%` |
  | `pipeline` | Three stages, build, test and ship, turn green one by one, and the tag at the end lights up. | `[x]build [~]test [ ]ship [ ]treat 52%` |
  | `install` | Forty-two invented packages are added, with a bar of blocks. | `+ [█████▎····] 21/42 52%` |
  | `code rain` | Digits and code punctuation fall and pile up from the floor until the screen is full. | `rain ▄▅▄▆▅▅▆▆ 52%` |
  | `hexdump` | 32 bytes appear one by one, starting at offset 2a. Read as text they spell `take a break; paused on line 42.` | `34: 61 6b 3b 20 70 61 75 __ \|ak; pau.\| 52%` |

  Their characters are plain keyboard characters plus line, block and bar characters, and one round dot. They use no emoji. All names in them are invented.
- **The six earlier meters are retired (version 0.18.1).** Wine, Khinkali, Churchkhela, Marshrutka, Khachapuri and Normal are no longer in the picker, and their pictures are no longer shipped. If you had chosen one, you now see `line 42` and can pick another of the five with `Change`. Nothing else you saved changes: your prizes, settings and acceptance stay as they were, and no second welcome reward is given.
- **Which limit the meter follows.** Whichever is closest to stopping you: the 5-hour or the weekly limit, as your account reports them. Long reset times read in days, such as `↻5d 14h`.
- **One press to accept and connect.** Nothing runs until you press `Connect`. The line under the chat box invites you with `👋 to turn on · /pauzza` for 7 days. The first `/pauzza` shows the Connect card described above, with `Not now` beside the button. One press accepts the Terms and Privacy Policy, confirms you are 18 or older, and connects. Until then, the add-on reads no usage figures, counts nothing, shows no prizes or pop-ups and sends nothing. If you decline, it stays silent. You can stop later with `☑ Pauzza is on` under ⚙: Pauzza stops and disconnects at once and, after a 10-second `Undo`, saved data is deleted. `Undo` brings back exactly what you switched off. If the Terms change, the panel says `Terms updated` and asks again with the same `Connect` button.
- **Presents.** One fictional present about 15 seconds after you accept, then one special offer each day at 12:00 local time. The meter fills toward the next one and shows the time left, such as `ln 11 ──>┄┄┄┄┄┄┄● 25% →🎁 18h`. A limit that has stopped you shows first. `🎁` followed by a number says that many are ready. The timer lives on your own computer and could be altered, which is fine only because the prizes are fictional.
- **Movement on the line.** All five meters move, and only with the "always show" line setting. While the AI is working, a cursor blinks, a spinner turns or the rain ripples. One small timer does this, the same one as before, a little over twice a second. It stops when work stops, and it only redraws numbers the add-on already has. The percentage shown stays the real one. Nothing moves at 100%. The movement never carries an offer.
- **Movement inside the panel drawings.** The drawings may blink a cursor, turn a spinner or let the rain fall. That movement is written into the drawing itself, so no timer runs for it, and it is off when your system asks for reduced motion. Without it each drawing is still and complete.
- **After accepting.** You start on one of the five terminal meters, chosen at random. One fictional welcome reward comes with it. The panel never opens by itself. You can change the meter later in `/pauzza` without getting another.
- **`🎁 1`** on the line means a reward is ready. It goes when your rewards drawer (`Mine`) or the `Daily Drop` drawer (`Daily offer` once connected) is in view, and prizes that arrive while it is open raise no mark.
- **`🛋 Limit Lounge · /pauzza`** appears at 100%. Before "Connect", while it shows, the best practice offers come first in the menu. After "Connect" the line still shows, and the offers keep the signed list's order.
- **`✨ good pace`** can appear when a 5-hour window ends with a peak under 80%. It comes with one fictional reward, at most once a day.
- If there are no limit figures, for example without a subscription or before the first reply, the line says `no limit data` and shows your waiting minutes.
- **Waiting Pays.** It counts the minutes the tool spends working, up to 60 per local day. At 15, 30 and 60 minutes your waiting time earns a fictional reward.
- **Finish Reward.** The first wait of 2 minutes or more each day earns one small fictional reward.
- **Limit prizes.** Reaching 100% of the 5-hour limit earns one fictional prize, at most once a day. Reaching 100% of the weekly limit earns one, at most once per week.
- **Daily Drop.** One fictional deal a day, unlocking at 12:00 your local time. No stock number is shown, so nothing suggests it is running out.
- **`/pauzza` prize menu.** Your meter comes first, large on Desktop and VS Code and as text in the terminal, with `Change` to flip through the five and choose. Above the list is the fixed line `Samples · not real offers`; once you are connected it reads `Partner offers`. Before you connect, below it are six drawers, one open at a time: `Mine` (your own rewards), `Daily Drop` and four categories, `Food`, `Drinks`, `Tickets` and `Gadgets`. Opening a drawer lists each brand with its offer, its code, always visible so it can be typed by hand, and a copy button that turns to a tick. ⚙ holds the display settings and the data reset.

## The status line's limits

- The tool puts its own prefix before the text, with a warning sign and the add-on's name: `pauzza …`. The add-on cannot remove it.
- The line cannot be clicked, so it points to `/pauzza` instead.
- Each add-on gets one line. Reports say the Desktop app may show only one add-on's line and hide the rest behind `+N`.
- The VS Code panel cuts a line at 200 characters or two rows. Pauzza's lines are under 80 characters.

## What it never does

- Before you press "Connect", the add-on's code never connects to the internet. After it, the code asks Pauzza's server only, for the offer list, for a code when you press `Get code`, and to withdraw. It never starts another program. Getting the add-on from GitHub, and any updates, is done by the tool itself.
- Never opens any file except its own `offers.json`, `release.json` (the end date, if any, and the public keys), `TERMS.md`, `PRIVACY.md`, and its own saved data, described below. The signed offer list from the server is kept in that saved data, not in a file of its own. It ships no picture files: every drawing is made by the code itself.
- Before "Connect", never sends anything anywhere. After it, sends only the requests listed above. A code reaches your clipboard only when you press its copy button.
- Links you open yourself: "View on the website" beside the Terms or Privacy Policy opens that page on GitHub in your browser. A connected offer may show its shop's domain as a link. It opens the shop's own address exactly as written in the signed offer list: `https` only, on a host that the signed list names, with no user name or port. The link shows that host, so you see where it goes. Opening it sends nothing to Pauzza, and the address is the same for everyone: no install number, token or code is in it.
- Never interrupts, plays a sound or pops up on its own. The panel opens only when you type `/pauzza`. The exceptions are short pop-ups inside the app, with built-in words only. Before "Connect": one for today's deal each day, and one for each limit prize. After it: a new offer, a limit prize that is really waiting, a campaign's start, and news, each only as often as the signed offer list allows each day; and a newer version, once for each version, which needs no rule from the list because the list carries only its number. At most one shows at a time. You can turn them off under ⚙.
- Never puts offers into anything the AI reads.
- Never treats a reward as payment for using the AI tool.

## Exactly what it reads

- **Usage numbers only.** It asks the tool for usage figures and uses the 5-hour and weekly windows' percentages and reset times. The tool's answer also holds context-window and cost figures, which the code does not use. None of these contain your code, prompts or conversations.
- **Whether the tool is working**, a yes-or-no signal from the band event above the prompt, plus the clock. The add-on adds nothing to that band.
- It does not handle the spinner's event or the hint line's event, so it does not receive the spinner's words.
- It handles the session start and its own `/pauzza` command. The tool passes those some general details, such as the working folder and anything typed after `/pauzza`, and the code does not read them. From panel events it reads only the panel's own id and which screen it is drawn on (Desktop, VS Code or terminal).

**What it sends** is listed under "Connecting to Pauzza's server" above: nothing before the Connect press, and afterwards the Connect request, the anonymous offer-list download, claims and the withdrawal.

Like any add-on, this one runs with your permissions. These are promises you can check by reading the code, not a technical lock. The validate command below lists every event it handles and call it makes.

A one-minute timer keeps the time to reset correct on the line while the session is idle. A one-second timer runs only until the first present arrives. Both read the usage numbers and the clock, update the saved record described below, and may show the pop-ups above. Neither ever uses the network. Both stop with the session.

A five-minute timer looks at the shared fetch schedule. Before "Connect" it does nothing at all. After it, it fetches the offer list when the schedule says it is due, and sends a waiting withdrawal.

## What it saves, where, and how to delete it

The add-on saves two small records, and after a Connect press up to seven more, on your computer only, in the tool's store for this add-on: a file under `~/.claude/plugins/store/`.

The first holds your answer: whether you accepted, declined or stopped, when, which version of the terms and wording you saw, when the invitation was first shown, and the history of those answers. Deleting saved data does not remove it.

The second contains exactly:

| Saved | Kept |
| --- | --- |
| Today's date | Replaced each day |
| Minutes counted today | Back to 0 each day |
| Which rewards you copied today | Cleared each day |
| Whether today's Finish Reward and good-pace bonus were earned, and today's Drop copied | Cleared each day |
| How many gift marks rose today, how many are waiting, and whether the good-pace note is showing | Cleared each day |
| Your meter choice, and whether the welcome reward was given | Until you delete it |
| The current 5-hour window's reset time and its highest percentage | Until you delete it |
| Which line setting you chose, and whether pop-ups are on | Until you delete it |
| Whether today's deal pop-up was shown, and today's 5-hour limit prize earned | Cleared each day |
| Until when this week's limit prize lasts | Until you delete it |
| The newest Pauzza version the update pop-up already announced | Until you delete it |
| When the add-on first ran, and which timed presents have been marked | Until you delete it |
| The last 8 offers you copied | Until you delete it |

It holds nothing about your code, prompts or conversations.

After a Connect press, these are saved as well:

| Saved | Kept |
| --- | --- |
| Whether you connected or disconnected, when, which wording and document versions you saw, and the history of those answers. The add-on version that made the Connect press. After a disconnect caused by changed texts, also a yes that this was the reason, so the Connect card can say so | Until the add-on's store is removed. The yes goes at the next Connect, or when you delete saved data |
| The install's token and its short reference, when the server first saw the install, and when it was last contacted | Until you disconnect |
| A withdrawal waiting to reach the server: the token and the versions | Until the server confirms it |
| Codes you claimed: the code, its offer's brand and text, its use-by date and when you claimed it, and the add-on version and the wording, Terms and Privacy versions of the connection it was claimed under | Until each use-by date, or the end date of a build that has one. A code claimed under a newer Pauzza's connection is left to that newer Pauzza |
| The last signed offer list, its sequence number and its format | Until you disconnect, or the end date of a build that has one |
| The highest offer-list number accepted: one number, the same for everyone who received that list | Until you delete saved data. It stays through a disconnect, so an older list is never taken again |
| When the offer list was last fetched, how many tries failed, and when the next try is due | Until you disconnect |
| When you last pressed `Try now` or `Check now` (a time only) | Until you disconnect |
| Which pop-ups were shown today, which offers were already announced, which campaigns had their start pop-up, the list number whose news pop-up was shown, which limit-prize periods had their pop-up, and whether a new-offer pop-up is still waiting today | Until you disconnect |

Other add-ons you install may be able to read this store. The token can only claim codes and withdraw.

**To delete it:** open `/pauzza`, press ⚙, press "Delete" next to "Saved data", then confirm with "Yes, delete". You are then back at the first-run step. If you are connected, this also disconnects and asks the server to delete your install record. Codes you already claimed stay until their use-by date. Uninstalling does not by itself promise to remove this file, so press that button first.

The tool may also delete the file if no session uses it for its clean-up period.

If two sessions run at once, each counts its own waiting time, toward the same daily limit of 60 minutes.

## Check before you run it

You need version 2.1.287 or later. Check with `claude --version`. Then, from a copy of this repository, list exactly what the add-on hooks and calls:

```
claude plugin validate .
```

The warnings about the author and icon do not affect how it runs.

## Try it for one session (nothing is installed)

```
claude --plugin-dir .
```

Close that session and the add-on stops. Its saved record stays until you delete it as described above.

## Install so it stays on

With version 2.1.292 or later, one command does it:

```
claude plugin install pauzza --marketplace pauzza-app/pauzza-marketplace
```

With any version from 2.1.287, the same in two commands:

```
claude plugin marketplace add pauzza-app/pauzza-marketplace
claude plugin install pauzza@pauzza
```

Then restart the app, or type `/reload-plugins` in an open session, and type `/pauzza`.

Each release is fixed to one exact, reviewed commit. You get a new version only when it is released and you update.

## Undo everything

First delete the saved data from `/pauzza` as described above. Then:

```
claude plugin uninstall pauzza@pauzza
claude plugin marketplace remove pauzza
```

If you used `--plugin-dir`, skip those two commands. Restart the app. If you made your own copy of this repository, you can delete that folder too.

## Terms and privacy

Read the [Terms](TERMS.md) ([ქართული](TERMS.ka.md)) and the [Privacy Policy](PRIVACY.md) ([ქართული](PRIVACY.ka.md)). The English and Georgian versions are equally valid; if they differ, the meaning more favourable to you applies. The Terms and the Privacy Policy are the texts in force from 20 November 2026. Pressing "Connect" accepts the Terms and the Privacy Policy and confirms you are 18 or older, in one press. Installing the add-on alone does not mean you agree to either.

## Security and contributing

See [SECURITY.md](SECURITY.md) and [CONTRIBUTING.md](CONTRIBUTING.md). The code is public so that you can read and check it; it is not open source. The terms are in [LICENSE](LICENSE).
