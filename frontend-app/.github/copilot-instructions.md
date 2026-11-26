# Copilot Engineering Instructions (React App + 3-Stage Jenkins, MCP-Free Compliant)

## Branch & Release Mapping
- Each monthly release uses a dedicated development branch (e.g. `develop-202701` -> `env3`).
- Feature branches MUST branch from the target release branch (e.g. `feat/xxx` from `develop-202701`) and open PRs back into that same release branch.
- Check `../frontend-cicd/config/branch-env-map.json` (when attached via `--add-dir`) to see the active branch-to-environment mapping.

## Local Verification & Commit Rules
1. Follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`).
2. Before creating or updating a PR, run:
   - `npm run lint` (`oxlint` + `eslint`)
   - `npx vitest related <changed-files> --run --passWithNoTests`
3. NEVER use `git commit --no-verify`. All gates (`ggshield`, `oxlint`, `eslint`, `commitlint`, `vitest related`) are enforced again in GHES PR Gate.
4. Do NOT leave `console.log()` in `src/` (only `console.warn` / `console.error` are permitted by ESLint).

## Diagnosing Jenkins CI / Release / CD Failures (No MCP Required)
Our enterprise environment does not enable Copilot MCP. Instead, use the sanctioned read-only CLI script:
- Check latest job statuses & see if a colleague is currently running an env:
  `npm run jenkins:status -- --branch develop-202701`
- Inspect failure logs for a specific Jenkins job/build:
  `npm run jenkins:log -- --job dev/react-demo-ci --build lastFailedBuild --grep "error|fail"`
- NEVER attempt to trigger production or CD deployments directly from local Copilot sessions; deployments are strictly triggered by Leader-approved PR merges or GitHub Actions `workflow_dispatch`.
