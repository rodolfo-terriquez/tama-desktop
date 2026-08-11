# Tama Release Checklist

Use this checklist when publishing a new GitHub release and auto-update artifacts.

## One-time setup

1. Generate or locate your Tauri updater private key.
2. Store it permanently outside the repository (example: `~/.tauri-keys/tama-updater.key`).
3. Set strict permissions:
   ```bash
   chmod 600 ~/.tauri-keys/tama-updater.key
   ```
4. In GitHub: `Settings -> Secrets and variables -> Actions -> Repository secrets`, add:
   - `TAURI_SIGNING_PRIVATE_KEY`: full file contents of your private key
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: key password (empty is OK if key has no password)
   - safest way (avoids copy/paste corruption):
   ```bash
   gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri-keys/tama-updater.key
   gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body 'YOUR_PASSWORD_HERE'
   ```
5. Confirm updater public key in [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json) matches your private key.

### Windows Authenticode signing

Windows publisher signing is separate from the Tauri updater signature above.
The project is preparing to use the free SignPath Foundation program described in
[`CODE_SIGNING_POLICY.md`](./CODE_SIGNING_POLICY.md).

Before enabling Windows signing in the release workflow:

1. Obtain approval for the Tama project from SignPath Foundation.
2. Configure the public GitHub repository as a SignPath trusted build system.
3. Create the SignPath project, artifact configuration, and release-signing policy.
4. Store the SignPath API token as a GitHub Actions repository secret. Never commit it.
5. Add the issued organization ID, project slug, signing-policy slug, and artifact-configuration slug to the release workflow.
6. Verify that Authenticode signing happens before the final Tauri updater signatures are generated or regenerated, because signing changes the installer bytes.

## Per-release checklist

1. Update version in:
   - `package.json` and `package-lock.json`
   - `src-tauri/Cargo.toml` (`[package].version`)
   - `src-tauri/Cargo.lock` (`tama-desktop` package version)
   - `src-tauri/tauri.conf.json` (`version`)
2. Run local checks:
   ```bash
   npm run lint
   npm run build
   cargo check --manifest-path src-tauri/Cargo.toml
   ```
3. Commit and push to `main`.
4. Create a new Git tag matching the version.
5. Create and publish a GitHub Release for that tag (not draft).
6. Wait for `.github/workflows/release.yml` to finish for all platforms.
7. Verify release assets include updater artifacts (including `latest.json` and signatures).
8. Verify Windows executables and installers have a valid Authenticode signature from SignPath Foundation.
9. Include a link to [`CODE_SIGNING_POLICY.md`](./CODE_SIGNING_POLICY.md) in the GitHub Release notes.

## Preflight builds (recommended before publishing a release)

1. Open GitHub `Actions`.
2. Select workflow `Release`.
3. Click `Run workflow` (this uses `workflow_dispatch`).
4. Run against your target branch.
5. Confirm all matrix builds pass:
   - `macos-14` (Apple Silicon)
   - `ubuntu-22.04`
   - `windows-latest`
6. If preflight is green, publish the actual GitHub Release to upload artifacts.

## Post-release verification

1. Open an older installed app version.
2. Confirm launch-time update prompt appears.
3. Accept update and verify install succeeds.
4. Restart app and verify updated version is running.

## Key safety notes

1. Never commit the private key to the repository.
2. Keep the same private key for all future releases.
3. If the private key changes, users on older versions may fail to verify updates.
4. If CI shows `failed to decode base64 secret key` or `Invalid symbol ...`, re-set `TAURI_SIGNING_PRIVATE_KEY` using `gh secret set ... < keyfile` (do not paste from terminal output).
