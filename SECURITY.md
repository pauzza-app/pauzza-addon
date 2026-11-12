# Security

## Reporting a problem

Please report security problems privately through this repository's **Security** tab, using **Report a vulnerability**. Do not open a public issue.

Include what you found, how to reproduce it and which version you used (see `.claude-plugin/plugin.json`).

## Supported versions

Only the latest version on the `main` branch is supported.

## What counts as a security problem

Pauzza's promises are listed in the README under "Connecting to Pauzza's server", "What it never does" and "Exactly what it reads". Anything that breaks one of them is a security problem.

The add-on talks to one server only, at the one address fixed in `hooks/server.ts`, and only after you press "Connect". All of its network traffic goes through one function, `send` in `hooks/server-link.ts`. The offer list it receives is used only if it carries a valid signature from one of the public keys in `release.json`; anything else is ignored. Security problems include:

- the add-on sending anything before "Connect" is pressed, sending more than the README lists, or contacting any other address;
- an offer list without a valid signature from a key in `release.json` being shown, or a reply from the server reaching the screen without the add-on's own checks;
- the add-on starting a program, or opening a file other than its own;
- the add-on reading code, prompts or conversations;
- an offer reaching anything the AI model reads;
- offer text being able to send control sequences to a terminal.

Like any add-on, Pauzza runs with your permissions. Its promises can be checked by reading the code, and `claude plugin validate .` lists every event it handles and every call it makes.
