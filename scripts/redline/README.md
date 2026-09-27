# Redline in CI

Redline is the gating code review on Sprayberry Labs' public repositories, and this directory is
the whole of it: the review, the first-party fix that answers a review, and the pin that ties each
repository to one commit of both.

## The review: `redline-review.yml` and `review.mjs`

Each repository's `.github/workflows/redline.yml` runs on `pull_request` and calls
`redline-review.yml` at a pinned commit, on that repository's `redline` runner (ephemeral, its own
account, reads only). `review.mjs` gives the model the PR and its diff, read-only tools over the
checkout, and ends when the model submits a verdict. The job's status is the verdict: APPROVE
passes, REQUEST_CHANGES fails. The finished review goes up as the `redline-verdict` artifact and
forge posts it as `sprayberry-redline` after checking where the run came from. `prompt.md` is the
reviewer's brief; `review.test.mjs` runs it all against a stubbed GitHub and model.

## The fix: `redline-fix-run.yml` and `fix.mjs`

When a review requests changes, forge dispatches the repository's `.github/workflows/redline-fix.yml`
(`workflow_dispatch`: `pr`, `head`, `review`, `dry_run`), which calls `redline-fix-run.yml` at the
same pinned commit on `[self-hosted, <repo>-exec]`, the repository's non-root exec runner. The job
checks that the checkout is exactly the reviewed head, then `fix.mjs`:

- reads the review (the `### N. Blocking:` findings, the `Minor:` list, the inline comments) and
  the PR with the workflow's read-only token;
- installs the checkout's dependencies once (npm, pnpm, yarn or bun, as detected);
- lets the model `list_files`, `read_file`, `search`, `write_file` (inside the checkout, never
  under `.github/`) and `run` an allowlist only: the package.json `test`, `lint`, `typecheck` and
  `build` scripts and `node <file>`, without a shell, in a scrubbed environment;
- runs the test script at least once after the last edit; a failing suite is bounced to the
  model once, then reported;
- commits everything changed except `.github/**`, files over 1 MB and what the install dirtied, as
  askalf, with a sanitised `fix:` subject and a body naming the review;
- writes `fix.json` (`outcome`: `fixed`, `no_change`, `tests_failed` or `refused`; the commits,
  files, tests, turns and notes), `notes.md` and, for a fix, `fix.bundle` (`<head>..HEAD`). A dry
  run writes `diff.patch` instead of committing.

Limits: 40 turns, 45 minutes, 30 files, 400 KB of diff; past any of them the outcome is `refused`.
The job exits 0 only for `fixed`. The artifact is `redline-fix`. Nothing on the runner can push:
forge verifies the artifact and pushes the commit to the PR branch with its own token, then
comments with the notes. The model key is the named dario key `first-party-fix` in
`/etc/askalf/fix-exec.env`, root:gha-exec 640, readable by the exec account and by no other
(never by gha-oss, which runs untrusted upstream candidates' suites on the same host).
`fix-prompt.md` is the fixer's brief; `fix.test.mjs` covers the parsing, the sandbox, the
allowlist, the limits, the commit and bundle on a real repository, and both workflows.

## The pin: `pin.mjs` and `redline-pin-bump.yml`

Both callers pin `askalf/askalf` by full sha and pass the same sha as `redline-ref`, which the
reusable workflow checks is a commit on `main` before fetching the script at it. A push to `main`
that changes any of this runs `redline-pin-bump.yml`, which rewrites `redline.yml` and, where a
repository has one, `redline-fix.yml` in every caller through `pin.mjs` and opens one bump PR per
repository. `node scripts/redline/pin.mjs --caller <sha> <repo>-exec` prints a new repository's
`redline-fix.yml`.
