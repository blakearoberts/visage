# Agents

This file is intended for LLM based collaborators.

## Guidelines

- Use the `codex` branch as the shared staging branch for next-type work that
  needs hosted CI before it is merged to `main`.
- LLM collaborators may push to `codex` for that staging purpose. Do not push
  directly to `main` unless the user explicitly requests it.
- The `codex` branch is for CI validation only; npm dist-tags are moved by
  `main` and release workflows.

## Command phrases

- "Promote codex" means:
  1. Work from the local `codex` branch.
  2. Commit only the intended changes to `codex`.
  3. Push `codex`.
  4. Wait for the remote `CI` workflow on the exact pushed `codex` commit.
  5. Only if that workflow succeeds, fast-forward `main` to that same commit and
     push `main`.
  6. Check out local `codex` before finishing.
  7. Or, use `npm run promote:codex -- -m "<commit message>"`.

## Programmatic checks

- `npm run typecheck`
- `npm run test:unit`
- `npm run build`
- `npm run format:check`
- `npm run test:e2e`

## Environment setup

<!-- TODO -->
