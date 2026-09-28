# Translation

**Tier P2 · Owner: `muna-module-developer` · Status: implemented (M5-E1d)**

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

## As built (M5-E1d)

### Where the text goes

Nothing leaves the machine until the user turns the module on; the pane says so next to the
switch, and the panel's footer names the host before the first request (*Text goes to
api.openai.com*). Two providers, chosen in the pane:

| Provider | Route | Wire | Default endpoint | Default model | Key |
| --- | --- | --- | --- | --- | --- |
| OpenAI-compatible (`openai`) | `POST {endpoint}/chat/completions` | SSE, `stream: true` | `https://api.openai.com/v1` | `gpt-4o-mini` | required before a request is sent; a server that ignores keys (LM Studio) takes any placeholder |
| Ollama (`ollama`) | `POST {endpoint}/api/chat` | NDJSON, `stream: true` | `http://127.0.0.1:11434` | `llama3.2` | optional |

- **Endpoint policy** (`provider::check_endpoint`): `https` anywhere; plain `http` only to a
  host on this machine or the local network (`localhost`, `*.local`, `*.lan`, a bare host
  name, loopback / private / link-local addresses). Anything else is `translation.endpoint`
  before a byte is sent — an `http` request to the internet would carry the key and the text
  in the clear.
- **Prompt**: one system message — *You are a translation engine. Translate the user's message
  [from X] into Y. Reply with the translation only …* — with the language **names** (models
  follow names better than tags), temperature 0.2. Source `auto` leaves the detection to the
  model.
- **Limits**: the text is at most 5 000 characters (`translation.tooLong`; past it the footer
  reads *Up to 5,000 characters at a time* and *Translate* waits), the answer is cut at
  20 000, a stream line at 256 KiB; connect 15 s, read 45 s.
- **Errors** (`TranslateError`, IPC codes `translation.*`): `disabled`, `empty`, `tooLong`,
  `noKey`, `endpoint`, `vault`, `offline` (no connection, DNS, timeout), `unauthorized`
  (401/403), `rateLimited` (429), `modelMissing` (404 or Ollama's *model not found*),
  `provider` (any other status or shape). The panel turns each into one sentence with the host,
  the model or the limit in it.

### Key storage

`translation_set_key(key)` normalises the paste (trimmed; spaces, line breaks, non-ASCII or
more than 512 characters are `translation.key.malformed`, nothing is `translation.key.empty`)
and stores it in Windows Credential Manager through the M3 `Secrets` trait under
`translation.<provider>.key`; `translation_clear_key()` removes it. The key is read at request
time only and goes into the `Authorization: Bearer` header and nowhere else. Logs carry the
entry name, the request id, the character count of the source and the number of chunks —
never the text, the answer or the key.

### Streaming and cancel

`translate({ text, source?, target? }) -> requestId` starts a job; the answer arrives as
`TranslationChunkEvent { chunk: { requestId, text, done, error } }` events, one per decoded
delta and a final `done: true` (with `error` set when the provider failed mid-stream).
`translation_cancel(requestId)` stops the read loop; nothing further is emitted for that id
(spike S2, `tests/translation.rs`). The service also drops every request in flight when the
provider, endpoint or model changes, and refuses new ones while the module is off.

The UI hook (`useTranslator`) buffers chunks that land before `translate` resolves (by id,
capped at eight), discards answers to a request it no longer waits for, cancels a running
request when the language pair changes, when *Stop* is pressed and when the panel unmounts,
and keeps the draft across panel openings. Ctrl+Enter translates; *Stop* stands in for
*Translate* while a request runs.

### Copy

*Copy* asks Rust (`translation_copy(text)` → `DragSource::place_on_clipboard`); the webview
never touches the clipboard. The button shows a tick for 1.5 s and the footer reads *Copied*.

### Languages

A closed list of 35 tags (`languages.ts`), named through `Intl.DisplayNames` in the UI locale;
the picker (search by name or tag, *Detect language* on the source side) is the same inline
list in the panel and the pane. The pair lives in the settings (`source`, `target`), so a
language picked in the panel becomes the default and the pane shows it. Swap is disabled while
the source is *Detect language*; swapping after a finished translation carries the answer into
the draft.

### Settings

`settings.modules.translation = { enabled: false, provider: 'openai', endpoint: '', model: '',
source: 'auto', target: 'en' }`. Blank `endpoint` and `model` mean the provider's default (the
pane shows them as placeholders); switching the provider clears both. Rust clamps the fields
to 512 characters and the tags to 35 and falls back to the defaults for anything it cannot
read. `get_translation_snapshot()` and the `TranslationChanged` event carry
`{ enabled, provider, endpoint, model, hasKey, needsKey, active }` — the effective endpoint
and model, whether a key is saved, whether the provider needs one, and how many requests run.

### Module surface

Panel (`translation`), a notch widget with the language pair, the settings pane, and the
command-palette action `translation.translate` (*Translate text*), which opens the panel with
the source box focused. The panel is content-sized: the source and output boxes are 98 px
tall each, the language list scrolls inside 204 px and a language button is at most 14 em
wide, so the panel fills the shell's 360 px at the 720 px minimum width and no language name
truncates.

### Deferred

- **Dictation** (the mic button): needs a `Speech` trait over
  `Windows.Media.SpeechRecognition`; not in M5.
- **Translate the clipboard or selection from a hotkey**: needs a clipboard *read* in the
  platform layer and the `Ctrl+C` simulation the spec flags; the `translation.translate`
  action is the keyboard route for now.
- **Live spike S2 run** against LM Studio or Ollama: rows 1–4 of
  [checklists/translation](../qa/checklists/translation.md); the scripted half passes in
  `tests/translation.rs`.
