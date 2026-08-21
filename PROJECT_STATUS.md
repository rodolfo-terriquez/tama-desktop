# Tama Project Status

Last updated: 2026-08-21

This is the handoff document for active work. Read it before investigating or
changing the project, and update it when the facts below change.

## Privacy boundary

- This repository is public. Treat every tracked note and GitHub-generated
  source archive as public material.
- Record external feedback anonymously. Do not include names, email addresses,
  direct message quotes, or other unnecessary identifying details.
- Project notes are not part of the compiled app. Tauri packages the generated
  `dist` frontend, native app binary and icons, and the explicitly configured
  `resources/silero_vad.onnx` file. Do not add handoff notes or correspondence
  to bundle resources or compile-time includes.

## Current production state

- Latest public release: [`v1.3.4`](https://github.com/rodolfo-terriquez/tama-desktop/releases/tag/v1.3.4),
  published from commit `4feea59e4fcb652e825575f203341d2377736840` on
  2026-08-13.
- Push-to-talk is available and avoids the aggressive silence detection that
  interrupted natural pauses.
- Current Windows releases are not Authenticode-signed. SignPath Foundation
  declined the project's free code-signing application on 2026-08-12 because
  Tama does not yet have enough external adoption and visibility signals.
- Microsoft Defender flagged the official `Tama_1.3.2_x64-setup.exe` as
  `Trojan:Win32/Wacatac.C!ml`. A false-positive submission was filed with
  Microsoft under submission ID `260c5851-4cc1-4813-ba05-16d785ab49fd` and was
  pending at the last check.

## Active local work

- Local branch `codex/voicevox-credits` adds a discoverable third-party credits
  dialog beside the version controls in Settings, selected-voice VOICEVOX
  attribution, voice policy loading from the local engine, and a README notice.
- This branch has not been merged into `main` or released yet.

The exact v1.3.2 installer currently published on GitHub was downloaded and
verified on 2026-08-12:

```text
Size: 13,577,122 bytes
SHA-256: 1f1c24040bea5b640ec625b8c0effceb202d0e53097efa479e5dfbe84eecb051
```

One report is not enough to conclude either that the installer is malicious or
that the user's computer is infected. A different hash for the user's detected
file would support local modification or corruption, while a matching hash
would show that Defender evaluated the same bytes published by GitHub. Do not
ask the user to restore or run a quarantined file merely to obtain the hash.

## Windows Whisper v1.3.4 outcome

An external Windows 11 tester reported that local Whisper transcription takes
about 30 seconds after every recording while Tama uses exactly 25% CPU. The
machine has 16 logical processors and an AMD Radeon GPU. Silence detection was
also too aggressive, which led to the push-to-talk work released in `v1.3.3`.

The likely explanation for the 25% ceiling is that the current Windows
`whisper-rs` path is CPU-only and was using too few threads. AMD GPU offload is
not currently available in Tama's Windows Whisper build.

### Released implementation

- The tested `codex/windows-whisper-test` branch was fast-forwarded to `main`.
- Feature commit: `01b31c4` (`Improve local Whisper performance`)
- CI fix commit: `95a43cf` (`Fix Windows test artifact signing`)
- Portable voice fix: `d2d0e52` (`Fix Windows portable voice startup`)
- Release-preparation commit: `3318bff` (`Prepare Tama v1.3.4`)
- Preflight-signing fix: `4feea59` (`Fix release preflight signing`)

The branch changes local Whisper to use approximately 75% of logical CPUs,
capped at 12 threads. On the tester's 16-logical-processor machine this should
use 12 threads. It also adds a bounded in-memory diagnostics log at the bottom of
Settings. The log is collapsed by default and supports Refresh, Copy, and Clear.
It records backend, thread count, language, timing, outcome, and errors, but
never audio or transcript text.

Local validation completed before the stable release:

- `npm run build`
- `npm run lint`
- `cargo fmt --check`
- Rust tests (6 passed)
- `cargo check`
- visual verification in the desktop app

The production-equivalent three-platform preflight passed at
<https://github.com/rodolfo-terriquez/tama-desktop/actions/runs/31730042736>:

- macOS Apple Silicon: 8m03s
- Linux x64: 10m27s
- Windows x64: 13m04s

The first manual preflight exposed that the encrypted updater key password was
not passed to the manual build step. Commit `4feea59` fixed that preflight-only
environment omission; the real release-upload step already passed the password.

### Windows test build

- Successful workflow run:
  <https://github.com/rodolfo-terriquez/tama-desktop/actions/runs/31717431952>
- Run ID: `31717431952`
- Commit: `d2d0e521400d66104dd408f8d276ce7b588af73e`
- Artifact name:
  `tama-windows-whisper-test-d2d0e521400d66104dd408f8d276ce7b588af73e`
- GitHub retention deadline: 2026-08-20

The artifact contains a portable x64 ZIP and an NSIS installer. The corrected
portable ZIP was published as an unsigned GitHub pre-release:

- Pre-release page:
  <https://github.com/rodolfo-terriquez/tama-desktop/releases/tag/windows-whisper-test-2026-08-12>
- Direct ZIP download:
  <https://github.com/rodolfo-terriquez/tama-desktop/releases/download/windows-whisper-test-2026-08-12/Tama-Windows-Whisper-Test-d2d0e52.zip>
- ZIP SHA-256:
  `c625c571d19d7fe8a3fe8c8d32bd65bbf845a888bc72e1d6aa9e4cc20e656841`

The public download was verified without GitHub authentication on 2026-08-13;
it matched the CI package byte-for-byte, its checksum matched, and archive
integrity passed. It contains both `tama-desktop.exe` and
`resources/silero_vad.onnx` in the path expected by Windows.
This test build is unsigned and may still be blocked by Defender; testers must
not be instructed to disable or bypass security software. The pre-release does
not replace `v1.3.3` as the latest stable release and does not contain updater
artifacts.

The tester reported on 2026-08-13 that Defender did not flag the portable test,
but push-to-talk stayed disabled. The published ZIP was downloaded again and
found to contain only `tama-desktop.exe`. It is not a complete portable build:
Windows expects `resources/silero_vad.onnx` beside the executable, so native
voice-session startup fails. The frontend also swallowed that startup error and
continued into the session, which explains the disabled control and missing
error message.

The defective `Tama-Windows-Whisper-Test-95a43cf.zip` asset was removed only
after the corrected public asset was downloaded and verified. The release notes
now identify commit `d2d0e52`, the required folder layout, and the corrected
checksum. The code also returns voice-start failures to both conversation UIs
instead of entering a dead session.

The corrected `d2d0e52` ZIP was sent to the tester on 2026-08-13. No runtime
result had arrived at that point.

The tester then confirmed that push-to-talk worked. Three comparable Japanese
recordings all completed successfully with 12 of 16 logical processors and
about 74% peak CPU usage:

```text
audio=4.58s  processing=24.25s  processing/audio=5.30x
audio=5.06s  processing=24.34s  processing/audio=4.81x
audio=5.41s  processing=24.32s  processing/audio=4.50x
```

Average processing time was 24.30 seconds, about 19% faster than the original
approximate 30 seconds. There was no meaningful first-run warm-up difference,
and the tester reported that it felt faster while still leaving room for other
programs. This validates the adaptive 12-thread behavior for the reported
machine, though local CPU Whisper remains about 4.87 times slower than the
recorded audio duration.

The owner approved merging the experiment and publishing stable `v1.3.4` on
2026-08-13. The production release workflow passed at
<https://github.com/rodolfo-terriquez/tama-desktop/actions/runs/31731246787>
(macOS 7m06s, Linux 10m35s, Windows 13m08s) and uploaded 14 public assets.

Post-release delivery verification confirmed:

- GitHub reports `v1.3.4` as Latest, non-draft, and non-prerelease.
- `latest.json` reports version `1.3.4`, contains nine updater platform
  mappings, and points only to `v1.3.4` assets.
- Manifest signatures exactly match their public `.sig` files.
- Downloaded Windows NSIS, macOS app archive, and Linux RPM payloads all verify
  cryptographically against Tama's embedded updater public key.
- Representative Windows, macOS, and Linux downloads were fetched without
  GitHub authentication and matched the published byte sizes.
- The downloaded macOS DMG checksum is valid. The app inside is Developer
  ID-signed by Rodolfo Alberto Lopez Terriquez, Gatekeeper accepts it as a
  Notarized Developer ID app, and the app has a stapled notarization ticket.
- The launch-time updater UI was not exercised locally because no older Tama
  app is installed in `/Applications`; public metadata and cryptographic
  delivery were verified directly instead.

VoiceVox speaking-speed and pitch controls are a separate future improvement
requested for beginner learners and are intentionally outside this release.
Additional anonymous feedback after `v1.3.4` reinforced two future ideas:

- Add Tama-owned VoiceVox speech controls, starting with speaking rate and
  potentially including pitch and other synthesis parameters.
- Explore an optional Windows Whisper GPU experiment, with Vulkan as the most
  plausible cross-vendor route for AMD hardware. Benchmark it against the
  adaptive CPU path, detect unsupported hardware or drivers, and always retain
  CPU fallback. This is an experiment, not a committed next-release feature.

The external tester volunteered to help with future Windows test builds. Ask
for the exact GPU model only when a scoped GPU experiment is ready.

Verified artifact checksums:

```text
c625c571d19d7fe8a3fe8c8d32bd65bbf845a888bc72e1d6aa9e4cc20e656841  Tama-Windows-Whisper-Test-d2d0e52.zip
5821911a42a85b489d56fba872ce1d34668c461c4cdce3700403cbb45f63e549  tama-desktop.exe
a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28  resources/silero_vad.onnx
5e4e0f78b6a5bfcbfa3e9297192430f0ee5d69f8d983a42fcaec8f88a486b6d1  Tama_1.3.3_x64-setup.exe
8addb9c5e556097cf01d2de43a409210871ecfd21c917f0cf6f0782ff594bab5  Tama_1.3.4_x64-setup.exe
e998f55a546d0da44e4670d5a0b4b088fa7ebf296a107d7bb91f3fa35acffeb5  Tama_1.3.4_aarch64.dmg
4c0d37be59e4ad6fa2707fafd1c9daf4b511d58d30ecb509810a392b5e516518  Tama-1.3.4-1.x86_64.rpm
```

The Windows test workflow disables Tauri updater-artifact creation only for its
private CI job so missing updater signing keys do not fail test builds. Stable
release artifacts use the production updater key and were verified above.

## What we are waiting for

1. Microsoft's determination on the Defender false-positive submission.

## Next decisions

1. Keep VoiceVox speed/pitch controls in the backlog rather than expanding the
   current release; speaking rate is the first useful control.
2. If Windows transcription needs a larger future improvement, evaluate the
   optional Vulkan GPU path described above with CPU fallback. Alternative
   backends or models such as Parakeet remain separate experiments.
3. If Defender blocks a future executable, collect the exact detection name
   and screenshot. Do not advise users to bypass Defender.
4. Update `actions/checkout` and `actions/setup-node` when suitable to remove
   GitHub's non-blocking Node.js 20 deprecation warning.

## Code-signing status

SignPath Foundation declined the free application on 2026-08-12. The reasons
given were insufficient public trust and visibility signals, including GitHub
stars, forks, contributors, independent references or discussions, and evidence
of sustained activity and engagement. This was not a technical or security
finding about Tama.

The available future paths are to reapply after Tama gains broader public
recognition or use a regular paid SignPath subscription. On 2026-08-12, the
project owner decided not to purchase paid code signing while Tama is free and
noncommercial. Reconsider paid signing only if the project's circumstances
change; otherwise, reapplication after broader adoption remains available. Do
not configure SignPath or change the release workflow without explicit
approval. Tauri updater signatures and Windows Authenticode signing remain
separate mechanisms.
