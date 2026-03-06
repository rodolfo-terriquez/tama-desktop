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

## Per-release checklist

1. Update version in:
   - `src-tauri/Cargo.toml` (`[package].version`)
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
