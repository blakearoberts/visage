# Release Process

Releases are GitHub Actions-driven. The workflows are split by entrypoint:

- The reusable `Checks` workflow contains the shared CI and E2E jobs.
- Every `CI` workflow push to `main` runs the shared checks, then publishes the next RC for the current package version to npm with the `next` dist-tag.
- Manual `Release` workflow dispatch from `main` prepares a stable version bump pull request.
- Merging a release pull request to `main` runs the shared checks, tags the merge commit, publishes to npm, moves the `latest` dist-tag, and creates the GitHub release.

## RC builds

Merging to `main` publishes an RC after CI passes. The workflow derives the RC base from `package.json` by stripping any prerelease suffix, checks the published npm versions for the highest existing `rc.N`, then publishes the next one.

For example, if `package.json` is `0.0.1-rc.5`, the next successful push to `main` publishes `0.0.1-rc.6` with the `next` dist-tag.

## Stable releases

Use the `Release` workflow's manual dispatch from the `main` branch.

The optional `version` input accepts a stable version such as `0.0.1` or `v0.0.1`. If omitted, the workflow uses the current package version without its prerelease suffix.

The prepare workflow:

1. Runs format, typecheck, unit tests, build, package, and E2E tests.
2. Verifies the run is still on the latest `main`.
3. Updates `package.json` and `package-lock.json`.
4. Builds and packs the bumped package version.
5. Pushes a `release/v<version>` branch.
6. Opens or updates a `chore(release): v<version>` pull request into `main`.
7. Dispatches the `CI` workflow on the release branch so the protected `main` status checks are available.

After the release pull request checks pass, merge it to `main`. The publish workflow then:

1. Runs format, typecheck, unit tests, build, package, and E2E tests again on the merged `main` commit.
2. Verifies the merged package version is a stable semver version.
3. Verifies the release tag and npm package version do not already exist.
4. Builds and packs the package.
5. Tags the merged `main` commit as `v<version>`.
6. Publishes the package to npm with provenance.
7. Moves the npm `latest` dist-tag to the released version.
8. Creates the GitHub release.

## Requirements

- Dispatch stable releases from the `main` branch.
- The release version must not include a prerelease suffix.
- The repository must have an `NPM_TOKEN` secret that can publish `@blakearoberts/visage`.
- GitHub Actions must be allowed to create pull requests so the Release workflow can open the version bump PR.
- The release PR title or merge commit message must retain `chore(release): v<version>` because that marker triggers stable publishing after merge.

## TO-DO

- [ ] Replace `NPM_TOKEN` publishing with npm trusted publishing through GitHub Actions.
