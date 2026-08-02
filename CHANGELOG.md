# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
