# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
