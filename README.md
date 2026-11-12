# Pauzza test

Version 0.20.2. A practice add-on. A small terminal-style meter sits on the status line, and your waiting time earns made-up test rewards, which you see by typing `/pauzza`. Every offer and code is fictional, such as "Test Pizza" with code TEST-0001.

New in 0.20.0, simplified in 0.20.1 and 0.20.2: a separate **Connect** step. Until you press "Connect", the add-on sends nothing and works from its built-in samples. After it, test offers and test codes come from Pauzza's server. They are still made up and work at no shop.

## The official copy

The only official copy is `https://github.com/pauzza-app/pauzza-addon`, and it is installed only through `pauzza-app/pauzza-marketplace`. Do not install Pauzza from anywhere else.

Pauzza never asks for your card details or passwords, and never asks you to run a command to claim a prize. If something using the Pauzza name does, it is not us.

## Connecting to Pauzza's server

### Before you press "Connect"

Nothing is sent: not the offer list, not a check for updates, nothing. Accepting the Terms is a different button and is not permission to connect. A test proves this for every screen.

The Connect card appears in `/pauzza` below the meter, once the Terms are accepted. It is a plain card, as light as the acceptance step: one sentence, "Connect to Pauzza's server to get made-up test codes. Pauzza never reads your code, prompts or conversations.", one `Connect` button, and one line under it, "By connecting you accept the Terms and Privacy Policy and confirm you are 18 or older.", where `Terms` and `Privacy Policy` open the two test documents inside the panel. The button is not chosen for you, so a stray Enter does not connect. There is no "Not now" button: closing the panel declines, and nothing is sent. The card stays there, quietly, for whenever you want it.

The card is not offered after the test's last day, which is fixed in `release.json`.

### What is sent, and when

Every request goes to one address fixed in this version, `https://pwchzyltlirhiiaxoifb.supabase.co/functions/v1/`. No address is ever taken from a reply.

| When | What is sent | What is not |
| --- | --- | --- |
| You press `Connect` | The versions of the wording, Terms and Privacy Policy that were on screen, and the add-on's version | No identifier of any kind. The server makes a random number for your install and sends it back |
| Every 4 to 5 hours while connected, at a random moment | A plain request for the signed offer list | No install number, no token, no cookie. The request is the same for everyone |
| You press `Get code` | The install's token, the offer's id, and a random key so that a repeated press cannot take two codes | Nothing else |
| You disconnect, switch Pauzza off, or delete saved data | The install's token and the three versions, so the server deletes your install record | Nothing else |

Like any internet request, each one shows the server your IP address.

Never sent, in any request: your code, prompts or conversations, file or folder names, your usage percentages, your waiting time, which meter you chose, or anything typed after `/pauzza`.

The offer list is fetched on a shared schedule only: at most every few hours, spread at random, with longer and longer waits after a failure (15 minutes, 30 minutes, 1 hour, up to a day). It is never fetched when the panel is drawn, when the line under the chat refreshes, or at 12:00.

### What the add-on does with what comes back

- **The offer list must be signed.** It is checked on your computer against public keys shipped in `release.json`. A list with a bad or missing signature, an unknown field, a wrong type, text outside plain English letters, digits and listed punctuation, a link outside the signed host list, or a size over 256 KB is refused whole, silently. So is an older list than the one already held, and one past its own end date. The last good list stays for up to 14 days; after that, or if none was ever received, the built-in samples show.
- **A code must look like a code:** capitals and digits with at most one dash. Anything else is thrown away and never reaches the screen or the clipboard.
- **The server decides** whether a code is given. The add-on only shows what should be ready.
- **Pop-ups come from built-in lines.** The signed list can say how many a day, never the words.
- **Slow, failed or oversized replies** count as no reply. The panel says so calmly and the samples keep working.
- **Every reply is checked before it is used.** An offer list must carry Pauzza's signature and a code must have the expected shape, or it is ignored. The add-on asks one address only; if that server ever redirected a request, the tool itself could follow the redirect, which the add-on cannot switch off, and the reply would still have to pass these checks.

### Codes

`Get code` asks the server once. It stays pressable when the add-on thinks it is offline: a press tries the server, and says `Can't reach Pauzza right now.` if that fails. The code shows in full once, then is hidden each time the panel opens (`••••••-0042`) until you press `Show`. `Copy` works while it is hidden. Claimed codes are under `Mine`. Each is deleted from your computer at its use-by date.

### How to disconnect

Open `/pauzza`, press ⚙, press `☑ Pauzza is on`. There is one switch: it stops Pauzza and disconnects it. Offers stop at once. For 10 seconds you can press `Undo`; nothing has been sent yet. Then the add-on asks the server to delete your install record. If the server cannot be reached, the request waits and goes out before anything else at the next start. Codes you already claimed stay until their use-by date.

`Delete` next to "Saved data" also disconnects, at once, with no undo time.

When the test ends, the add-on disconnects by itself, deletes the offer list and the test codes it received, and stops contacting the server.

### What the server keeps, and for how long

In short; the full text is the [test Privacy Policy](PRIVACY-REHEARSAL.md), which the Connect card opens.

| Kept on the server | Until |
| --- | --- |
| A random number for your install, a short reference shown in ⚙, when you connected, when you last claimed a code, the add-on's version | You disconnect, or the period after the test's end date given in the Privacy Policy |
| The test codes you claimed, and when | The period after the test's end date given in the Privacy Policy |
| A record that you connected and disconnected, and which wording you saw | 1 year |
| Your IP address in the host's technical logs | A few days, as the Privacy Policy says |

The server never receives your code, prompts, conversations, usage figures or waiting time.

## What it does

- **English only (version 0.19.0).** Every label, button, status line, pop-up, sample offer and both documents are in English. Nothing you saved changes, and nobody is asked to accept again: the Terms themselves are the same, only the language of the screen changed.

- **The line under the chat box.** Three settings under ⚙: always show the meter, only when something is ready (the default, such as `🎁 1 · /pauzza`), or off. Changing it needs no reload. Until you choose a meter, the line asks you to.
- **Meter on the status line.** Pick one of five in `/pauzza`. It follows your 5-hour usage limit, ends in the percentage and shows the time to reset, such as `ln 22 ─────>┄┄┄┄● 52% ↻2h 24m`. The line stays text; the drawings are only inside `/pauzza`.
- **The five terminal meters.** Each fills as the number rises and has a drawing in the panel and a text form on the line:

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
- **Accepting first.** Nothing runs until you accept. The line under the chat box invites you with `👋 to turn on · /pauzza` for 7 days. The first `/pauzza` shows a button with an unticked box, `☐ I accept the Terms`, with `Not now` beside it. Under them is the line `By pressing you confirm you are 18 or older.` and the Terms and Privacy Policy, which open inside the panel. Pressing the button accepts the Terms and confirms your age; it is not a consent to any data processing, because that button sends nothing. Connecting to the server is a separate step with its own button, described above, and that press is a consent. Until you press it, the add-on reads no usage figures, counts nothing, and shows no prizes or pop-ups. If you decline, it stays silent. You can stop later with `☑ Pauzza is on` under ⚙: Pauzza stops at once and, after a 10-second `Undo`, saved data is deleted. If the Terms change, the panel says `Terms updated` and asks with `☐ I accept the updated terms`.
- **Presents.** One fictional present about 15 seconds after you accept, then one special offer each day at 12:00 local time. The meter fills toward the next one and shows the time left, such as `ln 11 ──>┄┄┄┄┄┄┄● 25% →🎁 18h`. A limit that has stopped you shows first. `🎁` followed by a number says that many are ready. The timer lives on your own computer and could be altered, which is fine only because the prizes are fictional.
- **Movement on the line.** All five meters move, and only with the "always show" line setting. While the AI is working, a cursor blinks, a spinner turns or the rain ripples. One small timer does this, a little over twice a second. It stops when work stops, and it only redraws numbers the add-on already has. The percentage shown stays the real one. Nothing moves at 100%. The movement never carries an offer.
- **Movement inside the panel drawings.** The drawings may blink a cursor, turn a spinner or let the rain fall. That movement is written into the drawing itself, so no timer runs for it, and it is off when your system asks for reduced motion. Without it each drawing is still and complete.
- **After accepting.** You start on one of the five terminal meters, chosen at random. One fictional welcome reward comes with it. The panel never opens by itself. You can change the meter later in `/pauzza` without getting another.
- **`🎁 1`** on the line means a reward is ready. It goes when your rewards drawer (`Mine`) or the `Daily Drop` drawer is in view, and prizes that arrive while it is open raise no mark.
- **`🛋 Limit Lounge · /pauzza`** appears at 100%. While it shows, the best offers come first in the menu.
- **`✨ good pace`** can appear when a 5-hour window ends with a peak under 80%. It comes with one fictional reward, at most once a day.
- If there are no limit figures, for example without a subscription or before the first reply, the line says `no limit data` and shows your waiting minutes.
- **Waiting Pays.** It counts the minutes the tool spends working, up to 60 per local day. At 15, 30 and 60 minutes your waiting time earns a fictional reward.
- **Finish Reward.** The first wait of 2 minutes or more each day earns one small fictional reward.
- **Limit prizes.** Reaching 100% of the 5-hour limit earns one fictional prize, at most once a day. Reaching 100% of the weekly limit earns one, at most once per week.
- **Daily Drop.** One fictional deal a day, unlocking at 12:00 your local time. No stock number is shown, so nothing suggests it is running out.
- **`/pauzza` prize menu.** Your meter comes first, large on Desktop and VS Code and as text in the terminal, with `Change` to flip through the five and choose. Above the list is the fixed line `Samples · not real offers`. Below it are six drawers, one open at a time: `Mine` (your own rewards), `Daily Drop` and four categories, `Food`, `Drinks`, `Tickets` and `Gadgets`. Opening a drawer lists each brand with its offer, its code, always visible so it can be typed by hand, and a copy button that turns to a tick. ⚙ holds the display settings and the data reset.

## The status line's limits

- The tool puts its own prefix before the text, with a warning sign and the add-on's name: `pauzza …`. The add-on cannot remove it.
- The line cannot be clicked, so it points to `/pauzza` instead.
- Each add-on gets one line. Reports say the Desktop app may show only one add-on's line and hide the rest behind `+N`.
- The VS Code panel cuts a line at 200 characters or two rows. Pauzza's lines are under 80 characters.

## What it never does

- Before you press "Connect", the add-on's code never connects to the internet. After it, the code asks Pauzza's server only, for the offer list, for a code when you press `Get code`, and to withdraw. It never starts another program. Getting the add-on from GitHub, and any updates, is done by the tool itself.
- Never opens any file except its own `offers.json`, `release.json` (the test's end date and the public keys), `TERMS.md`, `PRIVACY.md`, `TERMS-REHEARSAL.md` and `PRIVACY-REHEARSAL.md`, and its own saved data, described below. The signed offer list from the server is kept in that saved data, not in a file of its own. It ships no picture files: every drawing is made by the code itself.
- Before "Connect", never sends anything anywhere. After it, sends only the requests listed above. A code reaches your clipboard only when you press its copy button.
- Links you open yourself: "View on the website" beside the offline Terms or Privacy Policy opens that page on GitHub in your browser. A connected offer may show its shop's domain as a link; it opens Pauzza's own address, which sends your browser on to the signed destination. The address carries the offer's id only.
- Never interrupts, plays a sound or pops up on its own. The panel opens only when you type `/pauzza`. Two exceptions are short pop-ups inside the app, one for today's deal each day, and one for each limit prize. While connected, the signed offer list sets how many pop-ups a day are allowed, and the words stay built in. You can turn them off under ⚙.
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

The add-on saves two small records, and after a Connect press up to five more, on your computer only, in the tool's store for this add-on: a file under `~/.claude/plugins/store/`.

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
| When the add-on first ran, and which timed presents have been marked | Until you delete it |
| The last 8 offers you copied | Until you delete it |

It holds nothing about your code, prompts or conversations.

After a Connect press, these are saved as well:

| Saved | Kept |
| --- | --- |
| Whether you connected or disconnected, when, which wording and document versions you saw, and the history of those answers | Until the add-on's store is removed |
| The install's token and its short reference, when the server first saw the install, and when it was last contacted | Until you disconnect |
| A withdrawal waiting to reach the server: the token and the versions | Until the server confirms it |
| Codes you claimed: the code, its offer's brand and text, its use-by date and when you claimed it | Until each use-by date, or the end of the test |
| The last signed offer list, and its sequence number | Until you disconnect, or the end of the test |
| When the offer list was last fetched, how many tries failed, and when the next try is due | Until you disconnect |
| Which pop-ups were shown today and which offers were already announced | Until you disconnect |

Other add-ons you install may be able to read this store. The token can only claim test codes and withdraw.

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

Read the [Terms](TERMS.md) ([ქართული](TERMS.ka.md)) and the [Privacy Policy](PRIVACY.md) ([ქართული](PRIVACY.ka.md)). The English and Georgian versions are equally valid; if they differ, the meaning more favourable to you applies. When you press "Connect" you also accept the [test Terms](TERMS-REHEARSAL.md) and the [test Privacy Policy](PRIVACY-REHEARSAL.md). Installing the add-on alone does not mean you agree to any of them.

## Security and contributing

See [SECURITY.md](SECURITY.md) and [CONTRIBUTING.md](CONTRIBUTING.md). The code is public so that you can read and check it; it is not open source. The terms are in [LICENSE](LICENSE).
