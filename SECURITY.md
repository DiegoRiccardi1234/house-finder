# Security Policy

## Reporting a vulnerability

Please report security issues privately, **not** through a public issue: open a
[security advisory](https://github.com/DiegoRiccardi1234/house-finder/security/advisories/new)
or write to `superdiego135@gmail.com`. Expect an answer within a few days.

## Supported versions

The latest release on `main` is the only supported version.

## Threat model

House Finder is a **local-first desktop tool**. It is not a service and is not meant to be exposed:

- The server binds to `127.0.0.1` only (`scripts/serve.ts`) and has **no authentication**. The
  config and reset endpoints are reachable by anyone who can reach the port — do not bind it to a
  LAN address, do not put it behind a public tunnel.
- Outbound traffic goes only to: the IMAP host you configure, the portals you scrape, and the LLM
  provider (OpenRouter). No telemetry, no analytics.

Hardening already in place: CSRF guard on state-changing routes, prototype-pollution guard on
user-supplied keys, an image proxy restricted by host allowlist (anti-SSRF), an SSE client cap, and
strict input validation with `zod`.

## Secrets and personal data

- **`.env`** holds the IMAP password and the OpenRouter API key. It is gitignored — keep it so, and
  rotate anything you suspect was exposed.
- **`state/`** holds the browser session (`fb-state.json`) and the listing archive. The archive
  contains **third-party personal data** scraped from public listings — names, phone numbers,
  addresses. The whole directory is gitignored (only the fictional `listings.demo.json` is
  versioned); do not commit it, do not publish screenshots of it.
- **`data/local/`** holds your personal search config and is gitignored. Every write from the UI
  lands there, so the versioned examples in `data/` are never overwritten with your data.

If you fork this project, re-check `.gitignore` before your first commit: this is the one mistake
that cannot be undone by a later commit.
