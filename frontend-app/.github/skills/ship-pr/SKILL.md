---
name: ship-pr
description: Verify React changes with oxlint, eslint, and vitest related, commit with Conventional Commits, push, and open a PR against the active develop-YYYYMM release branch.
---

# Ship PR Workflow

When the user asks to ship or open a PR for current changes:

1. Identify the base release branch (e.g. `develop-202701`). Confirm with `git branch --show-current` that we are on a feature/fix branch, not directly on `develop-*`.
2. List changed JS/TS files relative to the base branch and run:
   - `npm run lint`
   - `npx vitest related <changed-files> --run --passWithNoTests`
3. Check `git diff --cached` / `git diff` to ensure no hardcoded tokens, secrets, or `console.log` statements exist.
4. Stage changes and commit with a clear Conventional Commit message (NEVER use `--no-verify`).
5. Push the branch and open a PR against the target `develop-YYYYMM` branch using `gh pr create` with:
   - Summary of changes
   - Target release branch & mapped UAT environment (from `branch-env-map.json` if available)
   - Local verification checklist (`ggshield`, `oxlint`, `eslint`, `vitest related`)
6. Output the PR URL and remind the user that merging will automatically trigger the 3-stage Jenkins pipeline (`dev/ci` -> `dev/release` -> `uat/cd`).
