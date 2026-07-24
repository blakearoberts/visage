---
name: cut-stable-release
description:
  Cut a stable release for the Visage repo through the existing GitHub Actions
  release flow. Use when explicitly invoked as $cut-stable-release, or when the
  user says "Release visage", "cut a stable release", asks to prepare a stable
  Visage version, or asks to watch and verify a stable Visage release after the
  release pull request is merged.
---

# Cut Stable Release

## Source Files

Read these files before acting, because they are the current release contract:

- `AGENTS.md`
- `docs/release.md`
- `.github/workflows/release.yml`
- `.github/workflows/publish.yml`

Treat `AGENTS.md` safety limits as binding. Use this skill to execute the
existing release flow, not to replace it.

## Workflow

1. Infer the target stable version.
2. Report the inferred version and evidence. If the version is ambiguous, ask
   the user before continuing.
3. Verify local and remote release state is safe.
4. Dispatch the `Release` workflow from `main`.
5. Wait for the workflow-created release pull request and report its link for
   manual review and merge.
6. After the user confirms the pull request was merged, watch `CI` on the exact
   `main` merge commit.
7. Watch the downstream `Publish` workflow for that same merge commit.
8. Verify npm, git tag, and GitHub release artifacts all identify the stable
   version.

Stop at the release pull request until the user confirms it was merged. Do not
merge it yourself.

## Version Inference

Prefer the highest RC base newer than the latest stable tag. Otherwise inspect
changes since the latest stable tag and apply SemVer v2. For this repo's `0.x`
convention, breaking public API or meaningful new public behavior bumps minor,
and fixes bump patch.

Useful commands:

```sh
git fetch origin main --tags --prune
node -p "require('./packages/visage/package.json').name"
node -p "require('./packages/visage/package.json').version"
git tag --list 'v[0-9]*' --sort=-version:refname
npm view @blakearoberts/visage versions --json
```

Evidence to report:

- current package name and version from `packages/visage/package.json`
- latest stable `vX.Y.Z` tag, if one exists
- highest relevant `X.Y.Z-rc.N` train from git tags or npm versions, if one
  exists
- commit or pull request evidence for a SemVer bump when no newer RC train
  decides the version

## Preflight

Verify the release can be reasoned about before dispatching anything:

```sh
command -v gh
gh auth status
git status --short
git fetch origin main --tags --prune
git rev-parse main
git rev-parse origin/main
git ls-remote --heads origin "release/visage/v${VERSION}"
git rev-parse --verify --quiet "refs/tags/v${VERSION}"
git ls-remote --tags origin "v${VERSION}"
npm view "@blakearoberts/visage@${VERSION}" version
```

Required state:

- GitHub CLI is installed and authenticated.
- The checkout has no unexplained dirty state that would confuse release
  reasoning.
- Local `main` and `origin/main` identify the same commit.
- `release/visage/v${VERSION}` does not already exist on origin.
- `v${VERSION}` does not exist locally or remotely.
- `@blakearoberts/visage@${VERSION}` is not already published to npm.

For branch, tag, and npm existence checks, no output or a non-zero exit can be
the expected safe result. If `npm view` prints the version, stop because the
package is already published.

## Release

Dispatch the existing workflow from `main`:

```sh
gh workflow run "Release" --ref main -f "version=${VERSION}"
```

Find and watch the workflow run:

```sh
gh run list --workflow "Release" --branch main --limit 5
gh run watch "${RUN_ID}" --exit-status
```

After it succeeds, find the release pull request:

```sh
gh pr list --base main --head "release/visage/v${VERSION}" --state open --json url,title,headRefName,baseRefName
gh pr view "${PR_URL}" --json url,title,headRefName,baseRefName,files,commits,checks
```

Verify the pull request:

- title is `chore(release): v${VERSION}`
- head is the same-repository `release/visage/v${VERSION}` branch
- base is `main`
- changed files are only `packages/visage/package.json` and `package-lock.json`

Report the pull request URL to the user for manual review and merge.

## After Merge

Continue only after the user says the release pull request was merged. Resolve
the exact merge commit, then watch `CI` and `Publish` for that commit:

```sh
MERGE_SHA="$(gh pr view "${PR_URL}" --json mergeCommit --jq '.mergeCommit.oid')"
gh run list --workflow "CI" --commit "${MERGE_SHA}" --event push --limit 5
gh run watch "${CI_RUN_ID}" --exit-status
gh run list --workflow "Publish" --commit "${MERGE_SHA}" --limit 5
gh run watch "${PUBLISH_RUN_ID}" --exit-status
```

If the `Publish` run has not appeared yet, poll
`gh run list --workflow "Publish" --commit "${MERGE_SHA}" --limit 5` until it
appears or until it is clear that GitHub did not create the downstream run.

## Final Verification

Verify all stable artifacts identify the same version:

```sh
npm view "@blakearoberts/visage@${VERSION}" version
npm view @blakearoberts/visage dist-tags.latest
git fetch origin --tags --prune
git ls-remote --tags origin "v${VERSION}"
gh release view "v${VERSION}" --json tagName,targetCommitish,url,isPrerelease
```

Required success state:

- npm package version is `${VERSION}`
- npm `latest` dist-tag points to `${VERSION}`
- git tag `v${VERSION}` exists on origin
- GitHub release `v${VERSION}` exists and is not a prerelease
- the `main` merge commit, tag, GitHub release, npm package version, and npm
  `latest` dist-tag all align on the same stable version

## Failure Rules

If anything fails unexpectedly, stop and report:

- workflow or pull request links
- concise log excerpts
- likely root cause
- safest next action

Do not merge the release pull request, force-push release branches, move or
recreate tags, publish to npm manually, edit release or publish workflows,
bypass checks, or continue through one-off local fallbacks unless the user
explicitly approves that fallback after the root-cause report.
