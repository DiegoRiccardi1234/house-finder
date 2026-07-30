# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/DiegoRiccardi1234/house-finder/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/DiegoRiccardi1234/house-finder/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/DiegoRiccardi1234/house-finder/releases/tag/v1.0.0
