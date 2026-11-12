# Contributing

Thank you for helping. Please open an issue before starting anything large.

## Check your change

You need the tool's command-line version 2.1.287 or later, and Node.js.

```
claude plugin test .
claude plugin validate . > validate.txt
node scripts/check-public.mjs --validate-output validate.txt
node --test scripts/check-public.test.mjs
```

## Rules for every change

- Never read a person's code, prompts or conversations.
- Never put an offer into anything the AI model reads.
- One network call only: `send()` in `hooks/server-link.ts`, to the one address in `hooks/server.ts`, and never before the person presses Connect. No starting of other programs.
- Files opened with `$.fs.read` stay limited to `offers.json`, `release.json` and the four Terms and Privacy documents.
- Offers stay fictional: brands start with `Test ` and codes with `TEST-`.
- Treat every offer field as hostile: offer text passes `checkText` in `hooks/offers.ts`, and anything shown on the status line, in a pop-up or as a link passes `hooks/display.ts`. Add a hostile-input test to `tests/hostile.test.tsx` for each new field.
- Keep the saved-data table in the README in step with the `Saved` type in `hooks/waiting-pays.ts`.
- Keep the README true. If behaviour changes, change the promise in the same pull request.
- A new event or host call must also be added to `scripts/allowed-surface.json`, in the same pull request, for the owner to review.
- Never add a `pull_request_target` workflow.
- Never commit secrets, personal data or real coupon codes.

The code is public to read but is not open source: see [LICENSE](LICENSE). By sending a contribution you give U trust LLC permission to use, change and publish it as part of Pauzza. See [RELEASING.md](RELEASING.md) for how releases are made.
