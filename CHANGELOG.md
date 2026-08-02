# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.7.0] - 2026-08-02

### Fixed

- **The city was free text, and the engine knew two cities.** Typing "Milano" saved without a
  warning and the scraper then requested `https://www.subito.it/undefined` — no error, no listing,
  no way to tell why. Cities are now a list of **109 provincial capitals** (`src/config/cities.ts`)
  from which all three portals compose their own paths, and an unknown one stops the run with a
  message instead of quietly producing a broken address.
  The list is verified rather than hoped for: `npm run try:cities` asks every portal about every
  city. It found six that did not exist — Subito ignores "e della Brianza", writes the town as
  "reggio-nell-emilia" but the province as "reggio-emilia", and drops the "e" from Pesaro e Urbino.
  Those five are now measured overrides; Carbonia was removed, because on Subito it does not exist
  in any form and a city that finds nothing on one portal out of three should not be offered.

### Added

- **Describe what you are looking for, and the fields fill themselves.** In front of an empty form
  the real question is not *how much do I want to spend*, it is *what am I supposed to type here*.
  A sentence like "bilocale arredato a Torino sotto 700" is something anyone can produce. What the
  model understands is **not saved**: it fills the fields below, which stay the truth and are
  corrected by hand.
- **Neighbourhoods are picked, not typed from memory.** An included list for the cities that have
  one, the AI for the ones that do not; one click keeps a neighbourhood, two discards it, three
  makes it indifferent. It used to be an empty box with a placeholder and no way of knowing what
  the other options were — the thing that prompted this whole revision.
- **"Tipo di casa"** replaces *Locali min* and *Locali max*: the section title promised a field
  that did not exist, and translating "bilocale" into `2` and `2` was left to the reader.

### Changed

- The app opens where there is something to do. On a new installation it used to open on eight
  filters above an empty archive — the right screen for someone who already has listings, the
  worst for someone who has none yet.
- Settings tabs mark what is still missing, warnings lead to the tab they talk about (the AI badge
  used to land on the search screen), and two signposts that pointed at renamed tabs are gone.
- Switching settings tabs no longer destroys unsaved work, and a failed save no longer replaces
  the screen with a read error, taking the edits with it.
- *Cerca* pre-selects the channels that are **ready** instead of e-mail — the one needing the most
  setup outside the app — explains why the button is disabled, and shows how many listings arrived
  with a link to them. The summary was already being sent by the server and thrown away.
- A fresh installation no longer starts with must-haves already ticked and a notes field full of
  text the user never wrote: those came from the example file, which is an example of the format,
  not a starting configuration.
- The Facebook channel filter now matches the listings it collects, which arrive under two
  distinct channel ids and were therefore never found.
- The profile card reads the structured search instead of re-parsing the generated markdown with
  regular expressions — two views of the same thing, which is why one said "29 neighbourhoods" and
  the other 15.

## [1.6.0] - 2026-08-02

### Changed

- **Settings are organised by what you want to do, not by which file sits underneath.** The tabs
  used to be named after the files — "Criteri (AI)" was a markdown prompt in a textarea,
  "Ricerche/zone" was a raw JSON array with `minRooms` and `maxRooms`. To say you wanted a
  two-room flat in Turin under €750 you edited JSON in one box and repeated it in prose in
  another, keeping them aligned by hand.
  **"La tua ricerca"** replaces both: a row per search (city, name, max price, rooms), the
  must-haves as buttons, the neighbourhoods as two lists per city — keep and avoid — and a free
  text box for everything a field cannot express. The text the model reads is generated from all
  of it and still visible, read-only, at the bottom: checking what the AI actually receives was
  the one good thing about the old editor.
- Free-text criteria are not a fallback here, they are the point. The form covers the skeleton;
  the nuances that no field anticipates ("the centre only if it is under half the budget") keep
  their own box, verbatim, and go into the prompt as written.
- Facebook groups are a list with name, city and address instead of a JSON blob.
- The danger zone — *Svuota archivio* — appears once, under *App*, instead of at the bottom of
  every settings screen.

### Fixed

- **"Modifica" on the profile card now goes where it says.** It always navigated to the settings,
  but it landed on the raw criteria text: mechanically working, practically indistinguishable
  from a dead button. It opens the search editor.
- **The versioned example config no longer contains a real search.** `data/criteria.md` and
  `data/searches.json` shipped one person's cities, budgets and neighbourhood lists — in a public
  repository, and as the defaults inside every downloaded package, so a new user opened the app on
  someone else's search. They are now a recognisable example and an empty list, and a fresh
  install asks you what you are looking for. Personal configuration lives in `data/local/`, which
  is what the layout always intended.

## [1.5.0] - 2026-08-02

### Changed

- **The folder now has three entries and one of them is obviously the app.** `HouseFinder.exe`,
  `LEGGIMI.txt`, and `app\` holding everything else — `node.exe`, `node_modules`, the compiled
  server, the interface. It used to open on eleven entries including `package-lock.json`, with the
  thing to click being a `.vbs` sitting next to a `node.exe` that looked just as clickable. Someone
  opening that folder had no way to know where to start. It is the shape of the two sibling
  projects, where PyInstaller hides everything in `_internal\`.
- The launcher is a real executable with its own icon, compiled at build time by the C# compiler
  that ships inside Windows — no toolchain to install, and if it is ever missing the build falls
  back to the old `.vbs` rather than producing nothing. The icon is drawn during the build, so
  there is still no binary in the repository.
- `install-browsers.bat` is gone: it is a button now. The console launcher survives as
  `app\avvio-con-console.bat`, for when something refuses to start.

### Fixed

- The bundle build quotes its arguments. `shell: true` on Windows pastes them together unquoted,
  and this project lives under a path with a space in it — the resulting errors talk about
  anything but the real cause, and cost three separate detours in one afternoon.

## [1.4.1] - 2026-08-02

### Fixed

- **The ZIP now contains a single `HouseFinder/` folder**, like the sibling projects. It used to
  hold eleven loose entries, so extracting it into Downloads scattered them among everything else.
  Installations from 1.3.0 onwards update across the change without noticing: the updater already
  unwrapped a wrapper folder when it found one, and now it finds one.
- The build refuses to produce an incomplete package. `tsconfig.build.json` had the output
  directory hardcoded, so renaming the staging folder made the compiler write to one place while
  the packer read from another — the ZIP came out the right size, full of dependencies and without
  a single line of our own code. The path is now passed explicitly, and the build checks that the
  files it cannot work without are actually there before compressing.

## [1.4.0] - 2026-08-02

### Added

- **Nothing needs a terminal any more.** Three things still lived outside the interface, and from
  the downloadable bundle — where there is no npm — one of them was not merely awkward but
  impossible.
  - **Facebook sign-in from the UI.** *Config → Gruppi FB* opens a real browser window and lets you
    sign in by hand. Two-factor is not an obstacle here, and that is precisely why this beats the
    old shortcut that reused a Brave profile: the code is typed by the person, not guessed by the
    app — and it works for anyone, not only for someone who has that browser with the account
    already signed in. The card also shows *which* account is connected and until when its cookies
    are valid, so "is the session still good?" stops being a guess.
  - **Mailbox credentials in the UI.** *Config → Email*, with a real connection test on save. The AI
    keys were pasted into the interface while the mail password lived in `.env` — a text file you
    had to open in Notepad, which from a downloaded bundle is the same barrier as a command to
    type, only better disguised. Same rule as the AI keys: the password never travels back to the
    browser, and an empty field means "unchanged", not "delete it".
  - **Browser installation from a button**, in *Config → App*. Chromium is ~400 MB and ships
    separately; without it four channels out of five are unavailable.
- Long operations report progress through a small job API (`GET /api/jobs/:id`), so reloading the
  page mid-way — or watching from a second tab — shows the same state.

### Changed

- The "channel unavailable" messages name a place in the interface instead of a shell command:
  they are read by people who have no terminal to open.
- Mail settings resolve file-then-environment, like the AI keys, so what you type in the UI wins
  over what is in `.env`.

## [1.3.0] - 2026-08-02

### Added

- **The app updates itself.** *Config → App* checks the latest GitHub release and, one button later,
  downloads the bundle, verifies it, replaces the files and restarts — your archive, `.env` and
  personal config are never touched, and nothing is ever deleted. The comparison is numeric
  (`0.10 > 0.9`, which string comparison gets backwards) and requires the release to be strictly
  newer, so a local build ahead of the last release is never "updated" backwards.
- **A tray icon**, and a launcher with no console window. `HouseFinder.vbs` starts the server
  silently and leaves an icon in the notification area: open · copy address · quit. Quitting shuts
  the server down properly instead of killing a window. `HouseFinder-console.bat` keeps the visible
  window for when something refuses to start. Because the console can now be hidden, everything
  printed also goes to `state\logs\house-finder.log`.
- **You can pick the model**, per task, from *Config → Provider AI*. The engine already computed
  which one it recommends and which it would pick on its own — the browser was throwing that away,
  and the only way to pin a model was an environment variable. The dropdown groups models into
  recommended / other free / paid, and the "Automatic" entry always says who it would fall back to.
- `npm run try:update` runs the whole update against the real installed bundle — real process, real
  locked `node.exe`, real restart — with only the GitHub release feed faked locally.

### Changed

- The app version now lives in `src/version.ts`, is reported by `/api/meta`, and a test fails if the
  copies in `package.json` and `ui/package.json` drift from it.
- A pinned model is now honoured even when the health ranking would have dropped it: an explicit
  choice outranks a heuristic, and the failover still moves on if that model refuses. The pin also
  no longer leaks into the candidate list of *other* providers, where it could only 404.
- `index.html` is served with `Cache-Control: no-cache`. The hashed Vite assets can be cached
  forever, but the file that names them cannot — otherwise the first page load after an update
  points at files that no longer exist.
- Only one instance runs at a time: if the port is already answering as House Finder, the second
  launch opens the browser on it and exits instead of failing.

## [1.2.0] - 2026-08-01

### Fixed

- **Listing photos actually show up.** Thumbnails are now downloaded during a run and served from
  disk (`state/thumbs/`, gitignored) instead of being hotlinked. Facebook photo URLs are signed and
  expire within days — every card scraped more than a week ago had lost its picture — and Subito's
  CDN answers `400` unless the `?rule=` parameter is present. The cache key ignores Facebook's
  volatile signature, so the same photo is fetched once and not re-downloaded at every run.
- Listings already in the archive repair themselves: a re-run replaces a remote URL with the local
  copy. `npm run fix:thumbs` does the same in one pass for everything already stored.
- Cards fall back through local copy → remote URL → "no photo" placeholder. A broken image used to
  leave an empty grey box, which is why the problem looked worse than it was.
- The **vision stage** sends the photo as a base64 data URI instead of a raw URL, so it finally works
  on Subito and Facebook — where the provider previously received a `403` every single time. The
  Anthropic adapter unpacks the data URI into `media_type` + `data`, the form its API requires.
- `/thumbs/*` answers `404` for a missing file instead of falling through to the SPA's `index.html`.

### Changed

- OpenRouter's scoring pool drops `openai/gpt-oss-120b:free` (removed from the catalogue, zero
  endpoints) and `nvidia/nemotron-3-ultra-550b-a55b:free` (a reasoning model that burns the token
  budget on hidden chain-of-thought and truncates the JSON). What is left is the 26-40B instruct
  band, verified live: gemma-4-26b → gemma-4-31b → nemotron-3-nano-30b.
- README screenshots are regenerated from the demo dataset, which now carries free
  [Unsplash](https://unsplash.com/license) interior photos (`ui/public/demo/`, see
  [docs/CREDITS.md](docs/CREDITS.md)) — four listings stay photo-less on purpose, because that is
  what the app does when a listing has no usable image.

### Added

- `npm run fix:thumbs` — one-shot repair of the thumbnails already in the archive (run it with the
  server stopped, or the next save will overwrite the result).
- `npm run docs:shots` — regenerates `docs/*.png` from the demo dataset with the real config kept
  out of frame.

## [1.1.0] - 2026-07-30

### Added

- **Eleven LLM providers** behind one interface (OpenRouter, Cerebras, Groq, Google, Mistral,
  OpenAI, Anthropic, DeepSeek, xAI, Z.ai, and a custom OpenAI-compatible endpoint for Ollama /
  LM Studio). Keys are entered from the UI and stored in `data/local/providers.json`; the server
  returns only `configured`/`keyState`, never the key itself.
- **Failover chain** that tries other models on the same provider before switching provider, with
  per-reason penalty cooldowns (a truncation lasts an hour, a 429 five minutes) and an anti-brick
  rebuild when everything is penalized.
- **Profile tab**: search criteria in plain sight, per-channel and per-status counts, score
  distribution, and the active model with its failover chain.
- New endpoints: `/api/ai/providers`, `/api/ai/providers/:id/key`, `/api/ai/providers/:id/models`,
  `/api/ai/primary`, `/api/ai/health`, `/api/stats`.

### Changed

- **Design system**: semantic colour tokens with a real light/dark toggle (system-aware, persisted),
  self-hosted variable fonts, and twelve shared UI primitives replacing hand-written variants.
- Accessibility: labels on every control, a global focus-visible style, `role="tablist"` navigation
  with arrow keys, an accessible score badge (no longer colour-only), `prefers-reduced-motion`
  support, and a proper confirmation dialog instead of `window.confirm`.

### Fixed

- The listing grid now refreshes when a run finishes, filters survive tab switches, search is
  debounced with request cancellation, and a dead server shows an error instead of an empty page.

## [1.0.1] - 2026-07-30

### Fixed

- `GET /api/meta` now reports whether the Playwright browsers are actually installed, and marks the
  Subito / Immobiliare / Idealista / Facebook channels as unavailable when they are not. Previously
  the dashboard offered them even in the Windows bundle, which ships without the browsers, so
  starting a run failed with a Playwright error instead of an explanation.

## [1.0.0] - 2026-07-30

First public release.

### Added

- **Five ingestion channels** into a single deduplicated archive: portal e-mails over IMAP, and
  headed-browser adapters for Subito, Immobiliare, Idealista and Facebook (groups + Marketplace).
- **Batch AI scoring** (`src/ai/score.ts`): ~10 listings per request, extracting normalised fields
  (furnished, floor, lift, energy class, tenant constraints, contact type) and a 0-100 score with
  pros/cons in the same call. Per-field `zod` `.catch(null)` so a malformed free-tier JSON degrades
  one field instead of failing the run.
- **Health-aware model selection** (`src/ai/endpoint-health.ts`): live `/endpoints` check, uptime
  banding, 26-40B size sweet spot, sticky empirical penalties on `finish_reason=length` / empty
  answers / 429, chained failover. `npm run try:health` prints the chain without spending quota.
- **Vision stage** for listing photos.
- **Local web dashboard** (Express + React + Vite + Tailwind): filters, SSE live run log, favourite /
  contacted / discarded status, in-app config editor, one-click archive cleanup.
- **Durability**: atomic writes with `.bak`, fail-loud loading, per-channel isolation with
  incremental saves, store mutex, collision-safe dedup keys.
- **Server hardening**: `127.0.0.1` bind, CSRF guard, prototype-pollution guard, SSE cap, image proxy
  with host allowlist (anti-SSRF), Express error middleware.
- **Two-layer configuration**: versioned examples in `data/`, personal overrides in `data/local/`
  (gitignored) that win on read and receive every write from the UI.
- **Demo dataset** (`state/listings.demo.json`) with fictional listings, for screenshots and manual
  testing without touching the real archive.
- **CI** on Node 20 and 22 (type-check + 101 tests) and a Windows release bundle.

[Unreleased]: https://github.com/DiegoRiccardi1234/house-finder/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/DiegoRiccardi1234/house-finder/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/DiegoRiccardi1234/house-finder/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/DiegoRiccardi1234/house-finder/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/DiegoRiccardi1234/house-finder/releases/tag/v1.0.0
