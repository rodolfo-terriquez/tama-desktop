# Privacy Policy

Last updated: August 11, 2026

Tama is a desktop application for Japanese-language practice. It does not use
analytics, advertising trackers, or a developer-operated backend service.

## Data stored on your device

Tama stores study data and settings locally on your device. This includes
conversation sessions, quizzes, flashcards, persona chats, custom scenarios,
study plans, progress history, and app preferences.

API keys are stored in the app webview's local storage. They are not stored in
the operating system keychain and are not included in Tama account backups.

## Network requests

Tama transfers information to another system only to provide functionality that
you configure or request, except for the production app's update check described
below.

- **Anthropic:** If you select Anthropic, Tama sends the prompts, conversation
  messages, and learning context needed for the requested AI response to the
  Anthropic API using your API key.
- **OpenRouter:** If you select OpenRouter, Tama sends the prompts, conversation
  messages, and learning context needed for the requested AI response to the
  OpenRouter API using your API key.
- **OpenAI:** If you select OpenAI API transcription, Tama sends the recorded
  audio and any transcription prompt to the OpenAI API using your API key.
- **User-configured model servers:** If you select a local or custom
  OpenAI-compatible server, Tama sends requests to the server address you
  configure. That address can be on your device, local network, or the internet.
- **Local speech services:** VOICEVOX and Style-Bert-VITS2 requests use the local
  service addresses configured in the app unless you replace them with another
  address.
- **Downloads:** When you request a local Whisper model or VOICEVOX installation,
  Tama downloads the selected files from Hugging Face or GitHub.
- **Updates:** Production builds check the official Tama GitHub Releases endpoint
  for updates when the app starts. Update packages are downloaded only after you
  approve installation.

Tama does not send study data or API keys to the Tama developer. The third-party
service you choose may process and retain submitted data according to its own
terms and privacy policy:

- [Anthropic Privacy Center](https://privacy.anthropic.com/)
- [OpenRouter Privacy Policy](https://openrouter.ai/privacy)
- [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy/)
- [GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)
- [Hugging Face Privacy Policy](https://huggingface.co/privacy)

## Backups

Account backups are created locally at your request. They include study data and
non-secret preferences, but not API keys. Tama does not upload backups.

## Changes to this policy

Material changes to this policy will be published in this repository. Questions
or reports can be submitted through the project's
[GitHub Issues](https://github.com/rodolfo-terriquez/tama-desktop/issues).
