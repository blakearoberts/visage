# Agents

This file is intended for LLM based collaborators.

## Guidelines

- Use the `codex` branch as the shared staging branch for work that needs hosted
  CI before it is merged to `main`.
- LLM collaborators may push or recreate the remote `codex` branch for that
  staging purpose. Do not push directly to `main`.
- The remote `codex` branch is disposable after its changes merge; GitHub may
  auto-delete it. npm dist-tags are moved by `main` and release workflows.

## Code change discipline

- Prefer the smallest faithful diff that satisfies the request.
- Before editing, identify the intended behavior change and the files that
  should change. Keep the final diff inside that boundary.
- When the user provides a code snippet or target shape, treat it as the source
  of truth. Keep implementation structurally close to it; justify any deviation
  before adding it.
- Do not add fallback values, helper functions, lifecycle handling,
  dependencies, configuration, or abstractions unless they are required for the
  requested behavior.
- Prefer existing code shape and local patterns over new abstractions.
- After editing, review the diff line by line and remove code that is not
  directly required.

## Command phrases

- "Promote codex" means:
  1. Work from the local `codex` branch.
  2. Ensure the intended changes are already committed to `codex`.
  3. Push or recreate remote `codex`.
  4. Open or update a pull request from `codex` into `main`.
  5. Wait for the required pull request status checks to pass.
  6. Merge the pull request through GitHub.
  7. Wait for the remote `CI` workflow on the exact `main` merge commit.
  8. Fast-forward local `codex` to the `main` merge commit before finishing, and
     let GitHub auto-delete the remote `codex` PR branch.
  9. Or, use
     `npm run promote:codex -- --pr-title "<pull request title>" --pr-body "<pull request description>"`.
     The script does not commit changes. By default it refuses staged, unstaged,
     or untracked local changes; use `--ignore-staged` or `--ignore-unstaged`
     only after confirming those changes are unrelated to the promotion.
- "Release visage" or "cut a stable release" means:
  1. Infer the next stable version. Prefer the highest RC base newer than the
     latest stable tag; otherwise inspect changes since the latest stable tag
     and apply SemVer v2. Within SemVer's `0.x` initial-development latitude,
     use this repo's convention: breaking public API or meaningful new public
     behavior bumps minor, and fixes bump patch.
  2. Report the inferred version and the evidence for it. If the version is
     ambiguous, ask the user before continuing.
  3. Verify the local and remote release state is clean enough to reason about:
     GitHub CLI is installed and authenticated, `main` is current, the target
     tag does not already exist, and the package version is not already
     published to npm.
  4. Trigger the `Prepare Release` workflow from `main` with the inferred
     version.
  5. Wait for the workflow to create or update the `release/vX.Y.Z` pull
     request, then report the pull request link to the user for manual review
     and merge.
  6. Do not merge the release pull request, force-push release branches, move or
     recreate tags, publish to npm manually, edit release or publish workflows,
     bypass checks, or otherwise force the release through.
  7. After the user merges the release pull request, watch the remote `CI`
     workflow on the exact `main` merge commit.
  8. Watch the downstream `Publish` workflow for that same merge commit.
  9. Verify the npm package version exists, the `latest` dist-tag points to it,
     the Git tag exists, and the GitHub release exists.
  10. If anything fails unexpectedly, stop, collect the relevant workflow links
      and log excerpts, identify the likely root cause, and report the safest
      next action.

## Programmatic checks

- `npm run typecheck`
- `npm run test:unit`
- `npm run build`
- `npm run format:check`
- `npm run test:e2e`

## Environment setup

- `npm run promote:codex` requires the GitHub CLI (`gh`) to be installed,
  authenticated, and authorized to push to this repository.
