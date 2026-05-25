# Security Policy

## Supported Versions

Visage is currently pre-1.0 local-development tooling. Security fixes are
released for the active prerelease train only.

| Version                                      | Supported         |
| -------------------------------------------- | ----------------- |
| Latest prerelease on the npm `next` dist-tag | Yes               |
| Older prereleases                            | No                |
| Stable releases                              | Not yet available |

After the first stable release, this policy should be updated to name the
supported stable release line.

## Reporting a Vulnerability

Please do not report suspected security vulnerabilities in public GitHub issues.

Use GitHub private vulnerability reporting:
https://github.com/blakearoberts/visage/security/advisories/new

Include the affected Visage version or commit, operating system, Node version,
Docker version, browser, IdP configuration, a minimal reproduction, expected
behavior, observed behavior, and any known exposure of tokens, cookies,
certificates, credentials, or generated proxy configuration.

If the report is accepted, fixes will be coordinated privately and released
through the normal Visage release process. If the report is declined, the
maintainer will explain why and may ask that non-sensitive issues be re-filed
publicly.
