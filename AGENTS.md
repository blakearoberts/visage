# Agents

This file is intended for LLM based collaborators.

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
  4. Trigger the `Release` workflow from `main` with the inferred version.
  5. Wait for the workflow to create the `release/visage/vX.Y.Z` pull request,
     then report the pull request link to the user for manual review and merge.
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
      next action. Do not continue the release by creating or updating release
      branches, pull requests, tags, or npm publications through one-off local
      fallbacks unless the user explicitly approves that fallback after the
      root-cause report.

## Programmatic checks

- `npm run check`
- `npm run test:e2e`
- `npm test`
