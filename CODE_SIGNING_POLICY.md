# Code Signing Policy

Free code signing provided by [SignPath.io](https://signpath.io/), certificate
by [SignPath Foundation](https://signpath.org/).

> **Status:** The SignPath Foundation application is pending. Current Windows
> installers are not yet Authenticode-signed. This notice will be updated when
> signing is active.

## Scope

This policy applies to official Windows release artifacts for Tama that are
published from the
[`rodolfo-terriquez/tama-desktop`](https://github.com/rodolfo-terriquez/tama-desktop)
repository.

Official releases are published on the repository's
[GitHub Releases page](https://github.com/rodolfo-terriquez/tama-desktop/releases).
Windows artifacts submitted for signing must be produced by the repository's
public GitHub Actions release workflow on GitHub-hosted runners.

## Project roles

- **Committer and reviewer:**
  [Rodolfo Terriquez](https://github.com/rodolfo-terriquez)
- **Signing approver:**
  [Rodolfo Terriquez](https://github.com/rodolfo-terriquez)

Contributions from people without commit access must be reviewed by a project
reviewer before they are merged. Project members with source-code or signing
access must use multi-factor authentication for GitHub and SignPath.

Each release-signing request requires approval from the signing approver.

## Signing controls

- Only artifacts built from this project's source code and public release
  workflow may be submitted for signing.
- Release signing is limited to official release builds associated with a Git
  tag.
- Signing credentials and private keys must never be committed to this
  repository.
- Tauri updater signatures and Windows Authenticode signatures are separate.
  Official Windows update artifacts must retain valid updater signatures after
  Authenticode signing is complete.

## Privacy

Tama's data storage, network behavior, and third-party services are documented
in the [Privacy Policy](./PRIVACY.md).
