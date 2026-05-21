# Release Process

Releases are GitHub Actions-driven. The workflows are split by entrypoint:

- The reusable `Checks` workflow contains the shared CI and E2E jobs.
- The `CI` workflow runs the shared checks for pull requests and pushes.
- The `Publish` workflow runs after a successful `CI` workflow for a push to `main`; it publishes the next RC to npm with the `next` dist-tag for ordinary merges, or publishes a stable release with the `latest` dist-tag for release merges.
- Manual `Prepare Release` workflow dispatch from `main` prepares a stable version bump pull request and enables auto-merge for it.

## RC builds

Merging to `main` publishes an RC after CI passes, except for stable release merge commits. See [Publish target resolution](#publish-target-resolution) for the exact inputs, outputs, and target selection rules.

To start a non-patch release train after a stable release, make a normal pull request that sets `package.json` and `package-lock.json` to a prerelease seed for that train:

```sh
npm version 0.1.0-rc.0 --no-git-tag-version --ignore-scripts
```

When that PR merges and CI passes on `main`, the publish workflow publishes the next RC for that seeded train.

## Stable releases

Use the `Prepare Release` workflow's manual dispatch from the `main` branch.

The optional `version` input accepts a stable version such as `0.0.1` or `v0.0.1`. If omitted, the workflow uses the current package version without its prerelease suffix.

The prepare workflow:

1. Verifies the run is still on the latest `main`.
2. Verifies the release tag and npm package version do not already exist.
3. Updates `package.json` and `package-lock.json`.
4. Pushes a `release/v<version>` branch.
5. Opens or updates a `chore(release): v<version>` pull request into `main`.
6. Dispatches the `CI` workflow on the release branch so the protected `main` status checks are available.
7. Enables merge-commit auto-merge for the release pull request.

If the release pull request checks fail, the pull request remains open as the failure artifact. No tag, npm package, npm dist-tag, or GitHub release is created.

After the release pull request checks pass, GitHub auto-merges it to `main` with a merge commit. The `CI` workflow runs the shared checks on that merged `main` commit. After those checks pass, the publish workflow uses [Publish target resolution](#publish-target-resolution) to publish with the `latest` dist-tag, then tags the merged `main` commit and creates or updates the GitHub release.

The stable release success state is aligned across source and stable package artifacts: the `main` merge commit, git tag, GitHub release, npm package version, and npm `latest` dist-tag all identify the same stable version. The npm `next` dist-tag is only moved by RC publishes and may remain on the latest RC after a stable release.

## Publish target resolution

### Inputs Needed

- From branch for the merge commit, for example `release/v<version>`.
- To branch for the merge commit, expected to be `main`.
- Commit that passed CI.
- Repo checkout at that commit, used for package name and package version.
- Published npm versions for the package, used only to choose the next RC number.

### Outputs Needed

- Publish mode:
  - `none`
  - `rc`
  - `stable`
- Package version to publish.

### Steps To Resolve

- Read package name and package version from the checkout.
- If the merge is from `release/v<version>` to `main`, and the checkout package version is the same stable version, output `stable` and that package version.
- Otherwise resolve an RC target:
  - if the checkout package version is already a prerelease, use that prerelease's stable base.
  - if the checkout package version is stable, use the next patch version as the RC base.
  - calculate the next RC version for that base from the published npm versions, using the committed RC number as the floor when the checkout is already an RC.
  - output `rc` and that RC version.

## Requirements

- Dispatch stable releases from the `main` branch.
- The release version must not include a prerelease suffix.
- npm trusted publishing must trust `.github/workflows/publish.yml` for `@blakearoberts/visage`.
- GitHub Actions must be allowed to create pull requests so the Prepare Release workflow can open the version bump PR.
- Only `blakearoberts` may dispatch stable releases.
- The `main` branch ruleset must allow merge commits because the Prepare Release workflow enables auto-merge with `--merge`.
- Release PR metadata must satisfy [Publish target resolution](#publish-target-resolution).
- Auto-merge skips pull requests that touch `.github/workflows/release.yml` or `.github/workflows/publish.yml`.
- The repository has a `v* release tags` ruleset for `refs/tags/v*` that blocks creation, updates, and deletion except by the release automation app.

## After the first stable release

No `0.0.1`-specific cleanup is required. The publish workflow follows [Publish target resolution](#publish-target-resolution) for ordinary merges after the first stable release.
