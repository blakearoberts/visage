# Release Process

Releases are GitHub Actions-driven. The workflows are split by entrypoint:

- The reusable `Checks` workflow contains the shared CI and E2E jobs.
- The `CI` workflow runs the shared checks for pull requests and pushes.
- The `Publish RC` workflow runs after a successful `CI` workflow for a push to `main`, except for stable release merges, then publishes the next RC to npm with the `next` dist-tag.
- Manual `Prepare Release` workflow dispatch from `main` prepares a stable version bump pull request and enables auto-merge for it.
- The `Publish Release` workflow runs after a successful `CI` workflow for a release merge commit on `main`, then tags the merge commit, publishes to npm, moves the `latest` and `next` dist-tags, and creates or updates the GitHub release.

## RC builds

Merging to `main` publishes an RC after CI passes, except for stable release merge commits. The workflow derives the RC base from `package.json`:

- If `package.json` is already a prerelease, the RC base is that prerelease's stable base. For example, `0.0.1-rc.5` targets the `0.0.1` RC train.
- If `package.json` is stable, the RC base is the next patch version. For example, after stable `0.0.1`, the next ordinary successful push to `main` targets the `0.0.2` RC train.

For that base version, the workflow checks the published npm versions for the highest existing `rc.N` and publishes the next number, while using the committed `package.json` RC number as the minimum. For example, if `package.json` is `0.0.1-rc.5` and npm already has `0.0.1-rc.22`, the next successful push to `main` publishes `0.0.1-rc.23` with the `next` dist-tag.

To start a non-patch release train after a stable release, make a normal pull request that sets `package.json` and `package-lock.json` to a prerelease seed for that train:

```sh
npm version 0.1.0-rc.0 --no-git-tag-version --ignore-scripts
```

When that PR merges and CI passes on `main`, the RC workflow publishes the next RC for that seeded train.

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

After the release pull request checks pass, GitHub auto-merges it to `main` with a merge commit. The `CI` workflow runs the shared checks on that merged `main` commit. After those checks pass, the publish workflow then:

1. Verifies the merged package version is a stable semver version.
2. Verifies the merged commit is still the latest `main` commit.
3. Verifies the merged pull request came from `release/v<version>`, was authored by `github-actions[bot]`, and is titled `chore(release): v<version>`.
4. Builds and packs the package.
5. Tags the merged `main` commit as `v<version>`.
6. Publishes the package to npm with provenance, unless that exact package version is already published from a previous partial run.
7. Moves the npm `latest` and `next` dist-tags to the released version.
8. Creates or updates the GitHub release.

The stable release success state is aligned across source and package artifacts: the `main` merge commit, git tag, GitHub release, npm package version, npm `latest` dist-tag, and npm `next` dist-tag all identify the same stable version.

## Requirements

- Dispatch stable releases from the `main` branch.
- The release version must not include a prerelease suffix.
- The repository must have an `NPM_TOKEN` secret that can publish `@blakearoberts/visage`.
- GitHub Actions must be allowed to create pull requests so the Prepare Release workflow can open the version bump PR.
- Only `blakearoberts` may dispatch stable releases.
- The `main` branch ruleset must allow merge commits because the Prepare Release workflow enables auto-merge with `--merge`.
- The release PR title and release commit message must retain `chore(release): v<version>` because that marker identifies stable release merges and prevents the RC workflow from publishing for the same merge.
- Auto-merge skips pull requests that touch `.github/workflows/release.yml`, `.github/workflows/publish-release.yml`, or `.github/workflows/publish-rc.yml`.
- The repository has a `v* release tags` ruleset for `refs/tags/v*` that blocks creation, updates, and deletion except by `github-actions[bot]`.

## After the first stable release

No `0.0.1`-specific cleanup is required for the default patch RC flow. After `0.0.1` is stable and `package.json` contains `0.0.1`, the next ordinary successful push to `main` publishes the next patch RC, starting with `0.0.2-rc.0` if no `0.0.2` RCs already exist.

If the next train should be a minor or major version instead of the next patch, immediately open and merge a normal PR that seeds `package.json` and `package-lock.json` with that prerelease train, for example `npm version 0.1.0-rc.0 --no-git-tag-version --ignore-scripts`.

## TO-DO

- [ ] Replace `NPM_TOKEN` publishing with npm trusted publishing through GitHub Actions.
