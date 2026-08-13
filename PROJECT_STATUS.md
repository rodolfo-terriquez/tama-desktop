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
  <https://github.com/rodolfo-terriquez/tama-desktop/actions/runs/31551046349>
- Run ID: `31551046349`
- Commit: `95a43cf3903282d48e7cb074827fbee07d7b08e3`
- Artifact name:
  `tama-windows-whisper-test-95a43cf3903282d48e7cb074827fbee07d7b08e3`
- GitHub retention deadline: 2026-08-19

The artifact contains a portable x64 `tama-desktop.exe` and an NSIS installer.
The portable executable was separately packaged for Josje and published as an
unsigned GitHub pre-release:

- Pre-release page:
  <https://github.com/rodolfo-terriquez/tama-desktop/releases/tag/windows-whisper-test-2026-08-12>
- Direct ZIP download:
  <https://github.com/rodolfo-terriquez/tama-desktop/releases/download/windows-whisper-test-2026-08-12/Tama-Windows-Whisper-Test-95a43cf.zip>
- ZIP SHA-256:
  `c67378b1b2bb82692a9b6030c3ee515feea185cf89f15f5c5c29eaecfd97780d`

The public download was verified without GitHub authentication on 2026-08-12;
its checksum matched the local package and its archive integrity test passed.
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

A local, uncommitted fix packages the executable with the required resource and
returns voice-start failures to both conversation UIs instead of entering a dead
session. `npm run build`, `npm run lint`, workflow YAML parsing, and
`git diff --check` pass. No corrected Windows artifact has been built or
published yet.

Verified artifact checksums:

```text
17079ef8bfab58fb3d4f0f5a8a7518e8b40e8eb392bc4116ca415871892d122b  tama-desktop.exe
dd8c0c0bb145c487b9700fe70daaf734e27e935884f4e629d6471804d6e00f74  Tama_1.3.3_x64-setup.exe
```

The workflow disables Tauri updater-artifact creation only for this private CI
job so that missing updater signing keys do not fail the test build. Production
release configuration was not changed.

## What we are waiting for

1. Owner approval to commit/push the portable-package fix, run Windows CI, and
   replace the defective pre-release asset.
2. Josje's results from three comparable recordings using the corrected build:
   - copied Settings diagnostics
   - approximate transcription time
   - peak Tama CPU percentage in Task Manager
3. Microsoft's determination on the Defender false-positive submission.

## Next decisions

When Josje replies:

1. Do not interpret the current disabled button as a push-to-talk logic failure;
   the published portable ZIP is missing its VAD resource.
2. After explicit approval, commit and push the local fix, verify the Windows CI
   archive contains `tama-desktop.exe` and `resources/silero_vad.onnx`, and only
   then replace the pre-release asset.
3. Compare first-run warm-up time with the following two recordings.
4. Confirm from diagnostics that the Windows build selected 12 threads.
5. Compare elapsed transcription time and CPU utilization with the original
   roughly 30-second / 25% result.
6. If the test is substantially faster and stable, prepare the branch for
   review and release only after explicit approval.
7. If it remains slow, investigate an optional alternative local
   transcription backend/model. Handy's Parakeet models are the leading
   candidate, but no integration decision has been made.
8. If Defender blocks the test executable, collect the exact detection name
   and screenshot. Do not advise the user to bypass Defender.
9. If the user is concerned about a wider infection, recommend updating
   Defender security intelligence and running a full scan as a precaution. An
   offline scan is reasonable if there are additional signs of compromise or
   the concern persists. Do not present a scan recommendation as proof that the
   machine is infected.

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
