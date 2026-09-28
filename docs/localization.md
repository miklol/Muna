# Localization

**Status**: Implemented (M5-E6) · **Owner**: `muna-docs-writer` · **Code**: `packages/i18n`,
`apps/desktop/src/lib/locale.tsx`, `scripts/i18n-check.mjs`

How Muna speaks a language: which catalog the UI reads, which locale `Intl` formats with, what
the shipped catalogs are and how far along each one is, the voice and the terminology the
drafts follow, how a locale is added or reviewed, and what `i18n:check` holds every file to.
English is the source of truth for every message; the other files are translations of it.

## Two locales, one setting

Settings → General → *Language* is `settings.general.language`: `system` (the default) or one
catalog tag from the bundled set. One setting resolves to two tags, because the text a user
reads and the way their dates and numbers look are separate choices in Windows too:

| | `system` | A chosen catalog (`de`, `pt-BR`, …) |
| --- | --- | --- |
| **Catalog** (the i18next language) | Walks the Windows display language and its fallbacks (`navigator.languages`): an exact match first (`pt-BR`), then the same language (`de-AT` → `de`, `pt-PT` → `pt-BR`), else English | That catalog |
| **Format** (the `Intl` tag) | The Windows **regional format** (Settings → Time & language → Region), read once by Rust with `GetUserDefaultLocaleName` and sent in `AppInfo.regionFormat`; without one, the display language | The same tag as the catalog, so a chosen German UI gets German dates and decimal commas |

The functions are pure and tested in `packages/i18n/src/locales.ts` (`resolveCatalogLocale`,
`resolveFormatLocale`); the desktop app applies them in `lib/locale.tsx`:

- `SettingsBridge` (in `app-providers.tsx`) calls `i18n.changeLanguage` when the setting or
  the catalog changes and provides the format tag through `LocaleProvider`. Switching is
  synchronous — every catalog is bundled — so the notch and the settings window change at once.
- **Every `Intl` call in the UI takes `useLocale()`**: dates, times, relative times, numbers,
  percentages, units, `Intl.DisplayNames`, `Intl.ListFormat`. Never `new Intl.X()` without a
  tag, never a literal `'en-US'`; the only exception is a test that pins the output.
- `applyDocumentLocale` mirrors the language i18next actually speaks onto `<html lang dir>`:
  `lang` for screen readers and hyphenation, `dir` so the layout flips for a right-to-left
  catalog. It reads the *resolved* language, so an unsupported right-to-left Windows language
  that shows English keeps English's direction.
- An unknown value in an older or edited `settings.json` behaves like `system`.

The language tiles on the General pane name every catalog in its own language
(`Intl.DisplayNames`, first letter raised) so a reader who cannot read the current one still
finds theirs; the Windows tile names the catalog it currently resolves to; every draft says
*Machine draft, not yet reviewed by a native speaker* on its tile.

## The catalogs

`packages/i18n/src/locales/<tag>.json`, nested by module (`media.panel.title`), English first.
The package flattens them to dotted keys for i18next (`keySeparator: false`) so the key types
stay linear in the number of messages, and strips every key that starts with `_` — those are
notes for people, not messages.

| Tag | Language | Status | Since |
| --- | --- | --- | --- |
| `en` | English | **Source**, written by the Muna team; carries no notes | M0 |
| `de` | German | Machine draft, every section awaiting a native speaker's review | 2026-09-28 |
| `fr` | French | Machine draft, every section awaiting a native speaker's review | 2026-09-28 |
| `es` | Spanish | Machine draft, every section awaiting a native speaker's review | 2026-09-28 |
| `pt-BR` | Brazilian Portuguese | Machine draft, every section awaiting a native speaker's review | 2026-09-28 |
| `ar-XB` | Pseudo right-to-left | Generated at runtime from `en`, never offered to users | 2026-09-28 |

Message rules, all checked by `i18n:check` (below) where a script can:

- **Interpolation is i18next's `{{name}}`**, not ICU: a translation keeps exactly the source's
  placeholders. Word order may change (`Updated {{time}}` → `Aktualisiert {{time}}`), never the
  placeholder names. `docs/03-architecture.md` names the same choice.
- **Plurals are CLDR suffixes**: `count_one`, `count_other`, plus `count_zero` where English
  has it. A language with more forms (Arabic's `few`, `many`) adds them; every catalog carries
  `_other`, the form i18next falls back to.
- **Copy rules are the English ones** (`05-design-system.md` › Writing): sentence case, no
  exclamation marks, no jargon, empty states say what to do. A translation follows the target
  language's own sentence-case conventions (German capitalises nouns; French, Spanish and
  Portuguese only the first word).
- **Product names stay as they are**: Muna, Windows, Spotify, Bluetooth, GitHub, Claude Code,
  Copilot CLI, Ollama, WebView2, Open-Meteo, Obsidian. So do the names of GitHub's token
  permissions (*Pull requests*, *Metadata*) since the user must find them on github.com.
- **Numbers and units stay symbols** where English uses symbols: `{{percent}} %`,
  `{{value}} hPa`, `°C, km/h`. The one language-specific choice is the space before `%` and
  before a unit, which German, French, Spanish and Portuguese all write.

## Voice and terminology

The drafts were written to one voice per language and one word per concept. A reviewer keeps
this table honest — changing a term means changing it everywhere and noting it here.

| | German | French | Spanish | Brazilian Portuguese |
| --- | --- | --- | --- | --- |
| Address | *du*, imperative verbs (*Schalte …*, *Prüf …*) | *vous* | *tú* | *você* |
| Notch | die Notch | l'encoche | la Notch | a Notch |
| Island | Insel | Îlot | Isla | Ilha |
| Strip | Leiste | bandeau | franja | faixa |
| Panel | Panel | panneau | panel | painel |
| Shelf | Ablage | Étagère | Estante | Prateleira |
| Settings (Muna's) | Einstellungen | Réglages | Ajustes | Configurações |
| Settings (Windows's) | Windows-Einstellungen | Paramètres Windows | Configuración de Windows | Configurações do Windows |
| Overlay / Reserved (notch mode) | Überlagern / Reserviert | Superposition / Réservé | Superpuesto / Reservado | Sobreposto / Reservado |
| Pull request | Pull Request (noun, capitalised) | pull request | pull request | pull request |
| Checks (CI) | Checks | vérifications | comprobaciones | verificações |
| Review | Review | relecture | revisión | revisão |
| Credential Manager | Windows-Anmeldeinformationsverwaltung | Gestionnaire d'informations d'identification Windows | Administrador de credenciales de Windows | Gerenciador de Credenciais do Windows |
| Focus (pomodoro) | Fokus | Concentration | Concentración | Foco |
| Snooze | Schlummern / Später | Plus tard | Posponer | Adiar |
| Tiles (drop actions) | Kacheln | tuiles | mosaicos | blocos |
| Flyouts (volume, brightness) | Flyouts | volets | controles flotantes | controles flutuantes |
| Inbox (notes) | Eingang | Boîte de réception | Bandeja de entrada | Caixa de entrada |
| Ctrl key | Strg | Ctrl | Ctrl | Ctrl |
| Durations | `{{hours}} Std. {{minutes}} Min.` | `{{hours}} h {{minutes}} min` | `{{hours}} h {{minutes}} min` | `{{hours}} h {{minutes}} min` |
| Quotes | „…“ | « … » | «…» | “…” |
| Punctuation spacing | — | a space before `:` `;` `?` (`Traduire de : {{language}}`) | — | — |

## The review notes

Every top-level section of a non-English catalog carries a `_review` note, first key in the
section, and `i18n:check` fails without one. The drafts read

```json
"_review": "Machine draft (2026-09-28); not yet reviewed by a native speaker."
```

To review a section: read it against `en.json` in context (open the surface in Storybook with
the Language toolbar set to that catalog), fix what needs fixing, and replace the note with who
reviewed it and when — `"Reviewed by <name> (<date>)."`. When every section of a catalog is
reviewed, remove the tag from `DRAFTS` in `packages/i18n/src/locales.ts`: the tile on the
General pane then reads *Written by the Muna team* and `localeStatus()` answers `source`. The
notes are the only record of review; git history says who changed the text, not who read it.

## Adding a locale

1. Copy `en.json` to `locales/<tag>.json` (a BCP-47 tag as Windows reports it: `it`,
   `zh-Hans`), translate it, and add a `_review` note to every section.
2. Add the tag to `SUPPORTED_LOCALES` and `DRAFTS` in `locales.ts`, to `NATIVE_NAMES` if
   `Intl.DisplayNames` may lack it, and import it into `resources` in `index.ts`.
3. If the language has plural forms English lacks, add them (`count_few`, `count_many`).
4. Run `pnpm -w i18n:check` and `pnpm --filter @muna/i18n test`; the tests hold every catalog
   to the English key set.
5. A right-to-left language works without further code — `applyDocumentLocale` sets `dir`
   from i18next — but walk the pseudo-locale checklist below on the real catalog first.

Nothing else changes: the language tiles, the Storybook toolbar and the resolvers all read the
lists in `locales.ts`.

## The pseudo-locale

`ar-XB` (spike S3) is English with every message wrapped in U+202E RIGHT-TO-LEFT OVERRIDE …
U+202C POP DIRECTIONAL FORMATTING, so the text reads mirrored and `<html dir="rtl">` flips the
layout without a real translation. It formats as English (`resolveFormatLocale` answers `en`)
because its point is the direction, not Arabic numerals, and it is reachable only by name — the
Storybook *Language* toolbar lists it as *Pseudo RTL*; the settings tiles never do.

It exists to find layout bugs a translation would expose later: text clipped by a fixed width,
icons that should mirror and do not (chevrons, back arrows), padding and borders set with
physical properties instead of logical ones, punctuation that stays at the wrong end of a
line. Every panel and pane carries a `PseudoRtl` story since M5-E3 (E6 started with four: the
palette, the General pane, the notes panel and the translation panel) and the a11y audit runs
on them like on any other story. Findings are rows in the
[localization checklist](qa/checklists/localization.md).

## `i18n:check`

`scripts/i18n-check.mjs`, run by the `web` job and by `pnpm -w ci`:

1. Every locale has exactly the keys of `en.json` — no missing, no extra. A plural key counts
   by its base, and every catalog carries the `_other` form.
2. No empty strings.
3. No exclamation marks in English copy.
4. Every `t('key')` literal in `apps/desktop/src` and `packages/ui/src` exists in `en.json`.
5. A translation keeps the English message's `{{placeholders}}`, no more and no fewer.
6. A translation of two words or more is not the English message itself — that is a copied
   source string. Single words may be names or cognates. `SAME_EVERYWHERE` lists the product
   names and unit strings that read the same in every language; `SAME_AS_ENGLISH` lists, per
   language, the few messages it genuinely writes like English (the SI symbols `h` and `min`;
   *pull request*) with the reason. An entry whose message no longer matches is reported, so
   the lists cannot rot.
7. Every top-level section of a non-English catalog carries a `_review` note; English carries
   none.

The output ends with one line per catalog — `de.json: 1574 messages, 0 still English` — which
is the number to watch while a draft is being translated.

## Tests

- `packages/i18n/src/locales.test.ts` — the resolvers, the status and name helpers, the
  pseudo-locale wrapper.
- `packages/i18n/src/index.test.ts` — synchronous init and switching, region → language
  mapping, every catalog with the English key set and no notes, the mirrored pseudo-locale.
- `apps/desktop/src/lib/locale.test.tsx` — `resolveLocale` under `system` and a choice,
  `applyDocumentLocale`, `useLocale` with and without a provider.
- `apps/desktop/src/settings/settings-app.test.tsx` — choosing German switches the catalog.
- Storybook: the *Language* toolbar on every story; a `PseudoRtl` story on every panel and
  pane (M5-E3); `GermanChosen` on the General pane.
- Manual: [qa/checklists/localization.md](qa/checklists/localization.md) — the display
  language and regional format against real Windows settings, the pseudo-locale walk.

## Deferred

- Translating the landing site (`apps/site`, M5-E5) and the Storybook chrome.
- Locale-aware sorting: the one list that sorts by name (the day-progress timeline) calls
  `localeCompare` without a tag, so it sorts in the runtime's default locale rather than the
  format locale. An `Intl.Collator` through `useLocale()` is the fix when a second list needs it.
- Region-specific catalogs beyond `pt-BR` (`es-419`, `fr-CA`) — the language match covers
  them with the base catalog until someone asks.
- A translation memory or platform. The catalogs are plain JSON on purpose; a PR is the
  workflow.
