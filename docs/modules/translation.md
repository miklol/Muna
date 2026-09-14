# Translation

**Tier P2 · Owner: `muna-module-developer` · Status: spec**

## Reference
`demo-15`, `translation-feature-2`. Two text cards with language pills (`ENGLISH ▾`, `GERMAN ▾`),
central → button, swap ⇄, mic (dictation), copy.

## Providers
OpenAI-compatible chat endpoint (OpenAI, Azure OpenAI, OpenRouter, LM Studio) and Ollama
(`/api/chat`, streaming). System prompt enforces "translate only". Auto-detect source language.
Dictation via `Windows.Media.SpeechRecognition.SpeechRecognizer` (online/offline per OS).
Hotkey: translate clipboard/selection (`Ctrl+C` simulation flagged).

## Acceptance criteria
- Streaming tokens render progressively; cancel on language change.
- API key stored in Credential Manager; never logged.
