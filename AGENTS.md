# Agents

This file is intended for LLM based collaborators.

## Guidelines

- Use the `codex` branch as the shared staging branch for next-type work that
  needs hosted CI before it is merged to `main`.
- LLM collaborators may push to `codex` for that staging purpose. Do not push
  directly to `main` unless the user explicitly requests it.
- The `codex` branch is for CI validation only; npm dist-tags are moved by
  `main` and release workflows.

## Code change discipline

- Prefer the smallest faithful diff that satisfies the request.
- Before editing, identify the intended behavior change and the files that
  should change. Keep the final diff inside that boundary.
- When the user provides a code snippet or target shape, treat it as the source
  of truth. Keep implementation structurally close to it; justify any
  deviation before adding it.
- Do not add fallback values, helper functions, lifecycle handling,
  dependencies, configuration, or abstractions unless they are required for the
  requested behavior.
- Prefer existing code shape and local patterns over new abstractions.
- After editing, review the diff line by line and remove code that is not
  directly required.

## Command phrases

- "Promote codex" means:
  1. Work from the local `codex` branch.
  2. Commit only the intended changes to `codex`.
  3. Push `codex`.
  4. Open or update a pull request from `codex` into `main`.
  5. Wait for the required pull request status checks to pass.
  6. Merge the pull request through GitHub.
  7. Wait for the remote `CI` workflow on the exact `main` merge commit.
  8. Check out local `codex` before finishing.
  9. Or, use `npm run promote:codex -- -m "<commit message>"`.

## Programmatic checks

- `npm run typecheck`
- `npm run test:unit`
- `npm run build`
- `npm run format:check`
- `npm run test:e2e`

## Environment setup

<!-- TODO -->
