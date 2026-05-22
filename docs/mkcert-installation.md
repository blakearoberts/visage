Update Visage so `mkcert` is treated as an explicit system prerequisite instead of a hidden runtime download. On startup, Visage should check for `mkcert`, use the resolved executable when present, and when missing fail with clear platform-specific install guidance plus upstream documentation links. Include an explicit override such as `VISAGE_MKCERT=/path/to/mkcert`, and do not auto-download or execute a bundled/native binary by default.

---

I’d treat `mkcert` as a **system prerequisite**, not something Visage silently owns.

For a dev harness, automatic dependency management is slick when the dependency stays inside the project boundary. `mkcert` crosses that boundary: it installs a local CA into the OS trust store. Even with checksum verification, silently downloading and executing a native binary that can mutate system trust is a different class of action than installing npm dependencies.

The best default shape is:

- Visage checks for `mkcert` on startup.
- If found, it prints/uses the resolved path and continues.
- If missing, it fails with a clear platform-specific message:
  - macOS: `brew install mkcert`
  - Linux: distro-specific guidance or link
  - Windows: Chocolatey/Scoop/manual guidance
- Link to mkcert’s install docs.
- Allow an explicit override like `VISAGE_MKCERT=/path/to/mkcert`.
- Do not auto-download by default.

That is more toil, but it is honest toil. The user can see that a trust-store-capable tool is being installed, and the OS/package manager owns binary provenance, updates, and uninstall behavior.

If you want a slick path, make it a visible command, not hidden runtime behavior:

```sh
npx visage doctor
```

or:

```sh
npx visage setup-tls
```

That command can say exactly what is missing and what to run. I would still avoid “press enter and Visage downloads mkcert for you” as the default.

My practical recommendation: **use out-of-band mkcert install as the default**, and reserve internal cert generation for cases where trust-store install is not needed, like CI or Playwright flows that ignore HTTPS errors. That keeps Visage small, transparent, and easier to defend.

---

## Install Patterns

Run `mkcert -install` after installing `mkcert` when the local CA should be trusted by the OS/browser trust store.

### macOS

Homebrew is the primary install path:

```sh
brew install mkcert
brew install nss # optional, for Firefox
```

Sources:

- [mkcert upstream README: macOS installation](https://github.com/FiloSottile/mkcert#macos)
- [Homebrew mkcert formula](https://formulae.brew.sh/formula/mkcert)
- [Homebrew nss formula](https://formulae.brew.sh/formula/nss)

MacPorts is the alternative install path:

```sh
sudo port selfupdate
sudo port install mkcert
sudo port install nss # optional, for Firefox
```

Sources:

- [mkcert upstream README: MacPorts installation](https://github.com/FiloSottile/mkcert#macos)
- [MacPorts nss port](https://ports.macports.org/port/nss/)

### Linux

Debian and Ubuntu package repositories provide `mkcert`; install `libnss3-tools` too when Firefox/NSS trust-store support is needed:

```sh
sudo apt install mkcert libnss3-tools
```

Sources:

- [Debian mkcert package](https://packages.debian.org/source/mkcert)
- [Ubuntu mkcert package](https://launchpad.net/ubuntu/+source/mkcert)
- [mkcert upstream README: Linux certutil packages](https://github.com/FiloSottile/mkcert#linux)

Fedora packages `mkcert`; install `nss-tools` too when Firefox/NSS trust-store support is needed:

```sh
sudo dnf install mkcert nss-tools
```

Sources:

- [Fedora mkcert package](https://packages.fedoraproject.org/pkgs/mkcert/mkcert/)
- [mkcert upstream README: Linux certutil packages](https://github.com/FiloSottile/mkcert#linux)

Arch Linux packages `mkcert`; install `nss` too when Firefox/NSS trust-store support is needed:

```sh
sudo pacman -Syu mkcert nss
```

Sources:

- [Arch Linux mkcert package](https://archlinux.org/packages/extra/x86_64/mkcert/)
- [mkcert upstream README: Linux and Arch installation](https://github.com/FiloSottile/mkcert#linux)

openSUSE/SLES users need the NSS tools package before using mkcert with NSS-backed browsers:

```sh
sudo zypper install mozilla-nss-tools
```

Source:

- [mkcert upstream README: Linux certutil packages](https://github.com/FiloSottile/mkcert#linux)

Homebrew on Linux is the upstream-documented generic package-manager path:

```sh
brew install mkcert
```

Source:

- [mkcert upstream README: Homebrew on Linux](https://github.com/FiloSottile/mkcert#linux)

The upstream prebuilt-binary path is available when package managers are unsuitable:

```sh
curl -JLO "https://dl.filippo.io/mkcert/latest?for=linux/amd64"
chmod +x mkcert-v*-linux-amd64
sudo cp mkcert-v*-linux-amd64 /usr/local/bin/mkcert
```

Source:

- [mkcert upstream README: Linux prebuilt binaries](https://github.com/FiloSottile/mkcert#linux)
