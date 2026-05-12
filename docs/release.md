# Release Process

Releases are GitHub Actions-driven. The `CI` workflow has two publishing paths:

- Every push to `main` runs CI and E2E tests, then publishes the next RC for the current package version to npm with the `next` dist-tag.
- Manual workflow dispatch from `main` runs CI and E2E tests, commits the stable npm package version bump to `main`, tags that commit, publishes the GitHub release, publishes to npm, and moves the `latest` dist-tag.

## RC builds

Merging to `main` publishes an RC after CI passes. The workflow derives the RC base from `package.json` by stripping any prerelease suffix, checks the published npm versions for the highest existing `rc.N`, then publishes the next one.

For example, if `package.json` is `0.0.1-rc.5`, the next successful push to `main` publishes `0.0.1-rc.6` with the `next` dist-tag.

## Stable releases

Use the `CI` workflow's manual dispatch from the `main` branch.

The optional `version` input accepts a stable version such as `0.0.1` or `v0.0.1`. If omitted, the workflow uses the current package version without its prerelease suffix.

The workflow:

1. Runs format, typecheck, unit tests, build, package, and E2E tests.
2. Verifies the run is still on the latest `main`.
3. Updates `package.json` and `package-lock.json`.
4. Builds and packs the bumped package version.
5. Commits the version bump to `main`.
6. Tags the commit as `v<version>`.
7. Creates the GitHub release.
8. Publishes the package to npm with provenance.
9. Moves the npm `latest` dist-tag to the released version.

## Requirements

- Dispatch stable releases from the `main` branch.
- The release version must not include a prerelease suffix.
- The repository must have an `NPM_TOKEN` secret that can publish `@blakearoberts/visage`.

## TO-DO

- [ ] Replace `NPM_TOKEN` publishing with npm trusted publishing through GitHub Actions.
