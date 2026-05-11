# Release Process

Releases are tag-driven. GitHub Actions publishes the package to npm and creates the GitHub release when a `v*` tag is pushed.

## Procedure

1. Update the version in `package.json` and `package-lock.json`.
2. Commit the version change.
3. Create a matching git tag, such as `v0.0.1-rc.1` or `v0.0.1`.
4. Push the commit and tag.

```console
npm version 0.0.1-rc.1
git push
git push origin v0.0.1-rc.1
```

Prerelease versions, such as `0.0.1-rc.1`, publish to npm with the `next` dist-tag. Stable versions, such as `0.0.1`, publish with the `latest` dist-tag.

The release workflow runs CI, E2E tests, builds the package, publishes the packed artifact to npm with provenance, and creates a GitHub release that links to the published npm version.

## Requirements

- The git tag must start with `v`.
- The tag version should match the package version.
- The repository must have an `NPM_TOKEN` secret that can publish `@blakearoberts/visage`.

## TO-DO

- [ ] Replace `NPM_TOKEN` publishing with npm trusted publishing through GitHub Actions.
