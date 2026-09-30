# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

v1 is implemented as designed in `PLAN.md`, which remains the source of truth for behavior. Keep this file in sync when the code changes.

Use the `prompt-history` skill to maintain PROMPT-HISTORY.md — invoke it at the start of the session and keep it updated as work progresses.

## What this is

A lightweight page with no login that lists **free** AI models and services. Its data comes from two APIs:

- **Artificial Analysis (AA):** `GET https://artificialanalysis.ai/api/v2/language/models/free`
  - Needs a Free-tier key in the `x-api-key` header. The key goes in `AA_API_KEY` in `.env`. The non-`/free` routes return 403 for Free keys.
  - Limited to 100 requests per fixed 24h window. Results are paginated: loop over `?page=N` while `pagination.has_more` is true. As of 2026-09-29 that is 4 pages (~680 models), so one refresh costs ~4 calls.
  - Used **only** to add the intelligence index and output speed to LLM rows. Rows are joined through the hand-written `aa-map.json`.
  - `null` means "not measured", never 0.
  - Its docs say never to call it from the browser and to credit https://artificialanalysis.ai/ on the page. Never commit fetched data.
- **ComparEdge:** `GET https://comparedge.com/api/v2/discover?hasFreeTier=true&category=<cat>&limit=200`
  - No key needed.
  - `limit` is capped at 200 and there is **no offset or page parameter**, so fetch one request per category.
  - The old `comparedge-api.up.railway.app` host is dead.

## Architecture

- **Stack:** Node 18+ with **no npm dependencies** (`node:http`, global `fetch`), and plain HTML/CSS/JS in `public/`. There is no build step and no framework.
- **`server.js`** serves `public/` and `GET /api/data`.
  - The Artificial Analysis key stays on the server.
  - Cached data lives in memory and is mirrored to `cache/data.json`, so a restart doesn't spend quota.
  - The TTL is `CACHE_TTL_HOURS` (default 12).
  - Simultaneous refreshes share one in-flight promise.
  - The two sources are fetched with `Promise.allSettled`. If a refresh fails, the server serves the last good data and reports the problem in an `errors` array.
- **`sources.js`** fetches both sources and turns them into a common shape.
  - ComparEdge decides what is free, through `hasFreeTier=true`. AA scores are attached through `aa-map.json`, and each row names the AA model its scores come from.
  - Rows with `verifiedAt` older than 3 months are dimmed in the UI.
  - `USE_FIXTURE=1` serves `fixtures/sample.json`, which holds fake data, with no upstream calls.
  - ComparEdge scope is **AI categories only**: `llm, ai-coding, ai-image, ai-video, ai-voice, ai-agents, ai-writing, ai-assistants, ai-productivity`. Results are deduped by slug.
- **Front end:** fetches `/api/data` once, then does all filtering and sorting in the browser. Render API data with `textContent`, never `innerHTML`.

## Commands

- Run: `node server.js`, then open http://localhost:3000. Set `PORT` to change the port.
- Try without a key or network: `USE_FIXTURE=1 node server.js`.
- Syntax check: `for f in server.js sources.js public/app.js; do node --check "$f"; done`.
- There is no test runner. `PLAN.md` § Verification lists the manual curl checks: caching, merging of simultaneous requests, and the path-traversal guard.
