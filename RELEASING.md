# Releasing

Two public repositories are involved, so that changing what users receive always takes a deliberate second step:

- `pauzza-app/pauzza-addon` holds the add-on.
- `pauzza-app/pauzza-marketplace` holds one file that fixes each release to an exact commit.

**The owner alone changes `pauzza-marketplace`.** That one-file change is the deployment step: until it moves, nobody receives a new commit. Agents may prepare everything else, including the tag, the new marketplace file and a short change note. The owner reads the note and the diff, then commits and pushes from their own sign-in. Agents never hold write access to `pauzza-marketplace`. Until agents have a token limited to `pauzza-addon`, the owner pushes to both repositories.

## First release

**1. Fill in the open values.** Replace every bracketed value in the Terms and Privacy Policy, including the test versions `TERMS-REHEARSAL.md` and `PRIVACY-REHEARSAL.md`, and remove their draft notices. Set `"testEndDate"` in `release.json` to the test's real last day, the same day the two test documents give, and check that `"catalogueKeys"` holds the signing tool's public keys. The repositories live in the `pauzza-app` organisation. Never rename or delete it or them: someone else could claim the old address.

**2. Build a clean folder from tracked files only.** Commit every change first: only committed files are copied, so anything left uncommitted, and any file git does not track, stays behind. Run this from the add-on's own folder: `public-release/` in the company checkout, or the root of a clone of `pauzza-addon`. Never copy a working folder by hand: the tool generates `.claude-plugin/types/` on each machine, and it lists that machine's connected accounts.

```bash
test -z "$(git status --porcelain -- .)" || { echo "Commit or remove these changes first:"; git status --short -- .; exit 1; }
OUT="$(mktemp -d)/pauzza-addon"
mkdir -p "$OUT"
git ls-files -z | xargs -0 cp --parents -t "$OUT"
cd "$OUT"
```

**3. Create a fresh, single commit with a no-reply address.** Do not carry over any earlier history. Find your no-reply address with `gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"'`.

```bash
git init -b main
git config user.name "Pauzza"
git config user.email "<your no-reply address>"
git add -A
git commit -m "First public release"
```

**4. Check it.** Everything must pass, including the release check.

```bash
claude plugin test .
claude plugin validate . > validate.txt
node --test scripts/check-public.test.mjs
node scripts/check-public.mjs --validate-output validate.txt --release
gitleaks git . --config .gitleaks.toml --redact --no-banner
```

**5. Publish the add-on and tag the release.** Create the repository as public, push `main`, then:

```bash
claude plugin tag . --push
git archive HEAD | sha256sum
```

Publish the SHA-256 in the release notes.

**6. Pin it in the marketplace repository.** From the add-on folder:

```bash
SHA="$(git rev-parse HEAD)"
TAG="pauzza--v$(node -p "require('./.claude-plugin/plugin.json').version")"
node scripts/make-marketplace.mjs --repo "pauzza-app/pauzza-addon" --ref "$TAG" --sha "$SHA" --out ../pauzza-marketplace
cd ../pauzza-marketplace
claude plugin validate .
```

**Owner only:** read the change note and the diff, then commit that folder as its own single commit with the same no-reply address, and push it to `pauzza-app/pauzza-marketplace` from your own sign-in.

**7. Test a real install** on a clean profile, with the one-line form from the README (version 2.1.292 or later):

```bash
claude plugin install pauzza --marketplace pauzza-app/pauzza-marketplace
```

Then type `/reload-plugins` and `/pauzza` in a session. Also try the two-command form, `claude plugin marketplace add pauzza-app/pauzza-marketplace` then `claude plugin install pauzza@pauzza`. Then turn on the branch protection and security settings.

## Later releases

1. Raise `version` in `.claude-plugin/plugin.json`. People receive a new copy only when it changes.
2. Merge through a reviewed pull request. CI must pass.
3. Tag the merged commit and publish its SHA-256.
4. Agents prepare the new marketplace entry and a change note. The owner alone reviews it and pushes it, as in step 6.

Never rename or delete either repository or the owner account: someone else could claim the old address, and installs would follow it.
