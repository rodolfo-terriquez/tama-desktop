# Tama Project Status

Last updated: 2026-08-13

This is the handoff document for active work. Read it before investigating or
changing the project, and update it when the facts below change.

## Current production state

- Latest public release: `v1.3.3`.
- Push-to-talk is available and avoids the aggressive silence detection that
  interrupted natural pauses.
- Current Windows releases are not Authenticode-signed. SignPath Foundation
  declined the project's free code-signing application on 2026-08-12 because
  Tama does not yet have enough external adoption and visibility signals.
- Microsoft Defender flagged the official `Tama_1.3.2_x64-setup.exe` as
  `Trojan:Win32/Wacatac.C!ml`. A false-positive submission was filed with
  Microsoft under submission ID `260c5851-4cc1-4813-ba05-16d785ab49fd` and was
  pending at the last check.

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

## Active Windows Whisper investigation

A Windows 11 user, Josje, reported that local Whisper transcription takes about
30 seconds after every recording while Tama uses exactly 25% CPU. Their machine
has an AMD Ryzen 7 5700X3D with 8 cores / 16 logical processors and an AMD Radeon
GPU. Silence detection was also too aggressive, which led to the push-to-talk
work released in `v1.3.3`.

The likely explanation for the 25% ceiling is that the current Windows
`whisper-rs` path is CPU-only and was using too few threads. AMD GPU offload is
not currently available in Tama's Windows Whisper build.

### Unreleased test branch

- Branch: `codex/windows-whisper-test`
- Feature commit: `01b31c4` (`Improve local Whisper performance`)
- CI fix commit: `95a43cf` (`Fix Windows test artifact signing`)
- Portable voice fix: `d2d0e52` (`Fix Windows portable voice startup`)
- No pull request, merge, or stable release has been created for this work. An
  explicitly labeled unsigned pre-release is available for the external test.

The branch changes local Whisper to use approximately 75% of logical CPUs,
capped at 12 threads. On Josje's 16-logical-processor machine this should use 12
threads. It also adds a bounded in-memory diagnostics log at the bottom of
Settings. The log is collapsed by default and supports Refresh, Copy, and Clear.
It records backend, thread count, language, timing, outcome, and errors, but
never audio or transcript text.

Local validation completed before the Windows build:

- `npm run build`
- `npm run lint`
- `cargo fmt --check`
- focused Whisper tests (2 passed)
- `cargo check`
- visual verification in the desktop app

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

Josje reported on 2026-08-13 that Defender did not flag the portable test, but
push-to-talk stayed disabled. The published ZIP was downloaded again and found
to contain only `tama-desktop.exe`. It is not a complete portable build: Windows
expects `resources/silero_vad.onnx` beside the executable, so native voice-session
startup fails. The frontend also swallowed that startup error and continued into
the session, which explains the disabled control and missing error message.

The defective `Tama-Windows-Whisper-Test-95a43cf.zip` asset was removed only
after the corrected public asset was downloaded and verified. The release notes
now identify commit `d2d0e52`, the required folder layout, and the corrected
checksum. The code also returns voice-start failures to both conversation UIs
instead of entering a dead session.

The owner emailed Josje the corrected `d2d0e52` ZIP on 2026-08-13. No tester
runtime result had arrived at that point.

Josje then confirmed that push-to-talk worked. Three comparable Japanese
recordings all completed successfully with 12 of 16 logical processors and
about 74% peak CPU usage:

```text
audio=4.58s  processing=24.25s  processing/audio=5.30x
audio=5.06s  processing=24.34s  processing/audio=4.81x
audio=5.41s  processing=24.32s  processing/audio=4.50x
```

Average processing time was 24.30 seconds, about 19% faster than the original
approximate 30 seconds. There was no meaningful first-run warm-up difference,
and Josje reported that it felt faster while still leaving room for other
programs. This validates the adaptive 12-thread behavior for the reported
machine, though local CPU Whisper remains about 4.87 times slower than the
recorded audio duration.

The owner approved merging the experiment and publishing stable `v1.3.4` on
2026-08-13. VoiceVox speaking-speed and pitch controls are a separate future
improvement requested for beginner learners and are intentionally outside this
release.

Verified artifact checksums:

```text
c625c571d19d7fe8a3fe8c8d32bd65bbf845a888bc72e1d6aa9e4cc20e656841  Tama-Windows-Whisper-Test-d2d0e52.zip
5821911a42a85b489d56fba872ce1d34668c461c4cdce3700403cbb45f63e549  tama-desktop.exe
a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28  resources/silero_vad.onnx
5e4e0f78b6a5bfcbfa3e9297192430f0ee5d69f8d983a42fcaec8f88a486b6d1  Tama_1.3.3_x64-setup.exe
```

The workflow disables Tauri updater-artifact creation only for this private CI
job so that missing updater signing keys do not fail the test build. Production
release configuration was not changed.

## What we are waiting for

1. Successful local validation and three-platform release preflight for
   `v1.3.4`.
2. Microsoft's determination on the Defender false-positive submission.

## Next decisions

1. Complete the `v1.3.4` release checklist and verify the public updater assets.
2. Keep VoiceVox speed/pitch controls in the backlog rather than expanding the
   current release.
3. If Windows CPU Whisper needs a larger future improvement, evaluate an
   alternative backend/model such as Parakeet as a separate experiment.
4. If Defender blocks a future executable, collect the exact detection name
   and screenshot. Do not advise users to bypass Defender.

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
