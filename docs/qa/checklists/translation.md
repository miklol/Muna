# QA checklist · Translation

Covers the acceptance criteria of docs/modules/translation.md — tokens render as they
stream, a language change cancels, the key lives in Credential Manager and is never logged —
and the live half of spike S2 in
[m5-ship](../../build-plan/m5-ship.md#spikes-with-exit-criteria). The decoders, the endpoint
policy, the prompt, the request bounds, cancel and the vault paths are covered by
`tests/translation.rs` (a scripted provider; no test opens a socket); the panel, the pane,
the widget and the language list by the module's Vitest files and stories. This checklist is
the side only a real provider can show: a model answering over the wire, Windows Credential
Manager, and the failure statuses. Rows 1–4 are spike S2; they need a local server.

## Running it

1. Install [Ollama](https://ollama.com) or LM Studio and pull a small chat model (`ollama pull
   llama3.2`); note the server's address. An OpenAI-compatible key (OpenAI or OpenRouter) is
   needed for rows 16–19 only.
2. Start Muna (`scripts\dev.ps1`). Settings → Translation shows the privacy note, *Translate
   text* **off**, *Provider · OpenAI-compatible*, blank *Endpoint* and *Model* with the
   defaults as placeholders, *API key* with *Save*, and *Languages · Detect language → English*.
3. Keep the log (`%APPDATA%\Muna\logs`) open: no row may print the text, the answer or the key.
4. Drive the spike (rows 1–4), the panel (rows 5–15), the hosted provider and its failures
   (rows 16–23), the pane and the key (rows 24–31), the widget, the action, motion, keyboard
   and budgets (rows 32–38).
5. Paste the table below with the build, the date and the server used.

## Scenarios

| # | Scenario | Expect |
| --- | ---------- | -------- |
| 1 | Settings → *Provider · Ollama*, *Translate text* on; open the panel, type a paragraph, press *Translate* | the footer reads *Translating*, *Stop* stands in for *Translate*, and the answer grows word by word in the box below — not all at once at the end; the log reads `translation begins id=1 chars=…` then `translation finished id=1 chunks=N` with N > 1 and no text |
| 2 | Type a long paragraph, *Translate*, and press *Stop* after the first words | the answer stops growing at once; *Translate* is back; the log reads `translation cancelled id=…` and no `finished` line for that id; nothing further arrives (watch the box for ten seconds) |
| 3 | *Translate* a paragraph and, while it streams, click *Translate to: German* and pick *French* | the stream stops (`translation cancelled`); the head reads *French*; the box keeps what arrived; a new *Translate* answers in French |
| 4 | Point the endpoint at an Ollama server on another PC on the LAN (`http://studio.local:11434` or its LAN address), *Translate* | the answer streams over plain `http` (accepted for a local host); the footer reads *Text goes to studio.local* |
| 5 | With the module off (fresh install), open the panel | *Translation is off · Turn it on in Settings to translate text with your own provider. Nothing is sent anywhere until you do.* with *Open Settings*, which lands on the Translation pane |
| 6 | Module on, open the panel, read the head and the footer | *Translate from: Detect language*, *Swap languages* (disabled while the source is *Detect language*), *Translate to: English*, *Settings*; the footer reads *Text goes to 127.0.0.1* (the effective endpoint's host) and *Translate* is disabled while the box is empty |
| 7 | Type text and press Ctrl+Enter | the same as pressing *Translate* |
| 8 | After a translation, press *Copy translation* | the glyph turns to a tick and the footer reads *Copied* for a moment, then *Translation finished*; Ctrl+V elsewhere pastes the answer exactly, line breaks kept |
| 9 | Pick *Translate from: German* and *Translate to: English*, translate, then press *Swap languages* | the head reads *English → German*; the answer moves into the source box; the box below is empty again; Settings → Translation reads *German … English* swapped too |
| 10 | Click *Translate to: English* | the panel slides to a list headed *Translate to* with a search box and the current language ticked; type `ja` → *Japanese*; pick it → back to the pair with *Japanese*; the pane's *Languages* row shows *Japanese* as well |
| 11 | In the list, type `xx` | *No language matches*; *Clear search* empties the box |
| 12 | Collapse the panel mid-stream (move the pointer away) | the request is cancelled (`translation cancelled`); reopening shows the draft still in the box and an empty answer |
| 13 | Paste 5 001 characters | the footer reads *Up to 5,000 characters at a time*; *Translate* is disabled; trimming to 5 000 enables it |
| 14 | Stop the Ollama server, *Translate* | *No connection to 127.0.0.1. Check your network and the endpoint.* in the footer; *Translate* is back |
| 15 | Settings → *Model* `no-such-model`, *Translate* | *127.0.0.1 does not have the model no-such-model. Check it in Settings.* |
| 16 | Settings → *Provider · OpenAI-compatible*; open the panel without a key | the footer reads *Add an API key in Settings first* and *Translate* stays disabled with text in the box |
| 17 | Paste a real key in the pane, *Save*; back in the panel, translate | the footer names the host (*Text goes to api.openai.com*); the answer streams; the log has `translation key saved entry=translation.openai.key` and never the key |
| 18 | Edit the saved key in Windows Credential Manager (Control Panel → Credential Manager → Windows Credentials → `translation.openai.key`) to a wrong value, translate | *api.openai.com refused the API key. Check it in Settings.* |
| 19 | Endpoint `https://openrouter.ai/api/v1`, model `openai/gpt-4o-mini`, the OpenRouter key | the answer streams (SSE across a different OpenAI-compatible server) |
| 20 | Endpoint `http://api.openai.com/v1` (plain `http` to the internet) | *The endpoint is not an address text can go to. Check it in Settings.*; the log has no request line |
| 21 | Endpoint `not a url` | the same *endpoint* sentence |
| 22 | Fire many requests quickly against a free-tier key until the provider answers 429 | *api.openai.com asked for a pause. Try again in a moment.* |
| 23 | Endpoint pointed at a web server that answers HTML (`https://example.com`) | *example.com did not answer with a translation. Try again.* |
| 24 | Settings → Translation, read the pane with the module off | the privacy note (*Text you translate leaves your PC for the endpoint below, and nowhere else; nothing is sent until you turn this on. The API key stays in Windows Credential Manager, never in the settings file or the logs.*), *Translate text · Sends the text you enter to api.openai.com.*, *Provider*, *Endpoint* and *Model* with `https://api.openai.com/v1` and `gpt-4o-mini` as placeholders, *API key · Required by this provider. Saved in Windows Credential Manager.*, *Languages* |
| 25 | Switch *Provider* to *Ollama* after typing an endpoint and a model | both fields clear (the body says so); the placeholders read `http://127.0.0.1:11434` and `llama3.2`; *API key* reads *Optional; most local servers need none.* |
| 26 | Type an endpoint and press Tab, type a model and press Enter | each commits on blur / Enter, trimmed; `settings.json` → `modules.translation` shows them; the panel's footer names the new host |
| 27 | *API key*: press *Save* with the field empty | *Paste a key first.* under the row; nothing is stored |
| 28 | Paste `sk-live key with spaces`, *Save* | *That does not look like a key. Paste it again.*; nothing is stored |
| 29 | Paste a key, *Save* | the field clears; the row reads *A key is saved for OpenAI-compatible. It is never shown again.* with *Remove*; Credential Manager lists `translation.openai.key`; `settings.json` has no key |
| 30 | *Remove* | the field and *Save* return; the entry is gone from Credential Manager; the log reads `translation key removed entry=translation.openai.key` |
| 31 | Edit `settings.json` by hand: a 600-character `endpoint`, `"source": ""`, `"target": "x".repeat(40)` | Rust clips the endpoint to 512 characters and the tag to 35, the source falls back to `auto`; the pane still reads |
| 32 | Dashboard → *Add a widget* → Translation | *Detect language → English* with *Open the panel to translate*; *Translating* while a request runs; with the module off, *Translation is off · Turn it on in Settings* |
| 33 | Command palette → *Translate text* | the Translation panel opens with the source box focused |
| 34 | Tab through the panel | *Translate from*, *Swap languages* (when enabled), *Translate to*, *Settings*, the source box, the answer box (named *Translation*; arrows scroll a long answer), *Copy translation*, *Translate* / *Stop*; in the list, *Back* returns to the pair |
| 35 | Narrator on, translate | the footer is a single status region: *Translating* once, *Translation finished* once; the answer box is not read word by word while it streams (no live region) but reads as *Translation* when reached |
| 36 | Reduced motion (Windows *Animation effects* off) | the panel body fades in only; the pair ↔ list switch has no slide |
| 37 | Task Manager → Details, sort by CPU, panel closed for five minutes with the module on | `muna.exe` and `notch.exe` together stay under 0.3 % CPU; no network traffic from Muna (Resource Monitor → Network) |
| 38 | Windows 10 22H2 | rows 1, 17, 29 |

## Results

| Build | Date | Machine | Server | Rows passed | Notes |
| ----- | ---- | ------- | ------ | ----------- | ----- |
| | | | | | |
