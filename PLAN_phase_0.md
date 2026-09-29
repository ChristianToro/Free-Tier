> **Archived snapshot.** This is `PLAN.md` as it stood before the 2026-09-29
> plan review (grilling session). It is kept for reference only and is **not**
> the current plan. Its Artificial Analysis endpoint, quota, field paths and
> "free" definition turned out to be wrong. See `PLAN.md` for the current plan
> and `PROMPT-HISTORY.md` for what changed and why.

---

# Free-Tier AI Finder: lightweight page with a caching Node server

## Context
`/home/torosanctum/Next_Chapter/free-tier` is empty. The goal is a lightweight page (plain HTML/CSS/JS, no login) that shows which AI models and services are free. It pulls from two sources:
- **Artificial Analysis (AA)**, `GET https://artificialanalysis.ai/api/v2/data/llms/models`. It needs the `x-api-key` header, allows 1,000 requests a day, requires attribution to https://artificialanalysis.ai/, and says not to call it from the browser. Pricing fields are `price_1m_input_tokens`, `price_1m_output_tokens` and `price_1m_blended_3_to_1`.
- **ComparEdge**, `GET https://comparedge.com/api/v2/discover?hasFreeTier=true&category=<cat>&limit=200`. I checked it live: no key, CORS is open, `limit` is capped at 200, and there is no offset or page parameter. So I fetch **one request per category** to get full coverage. Each result looks like `{slug, name, category, startingPrice, freeTier, verifiedAt, links.page}`. (The old `comparedge-api.up.railway.app` host is dead.)

Decisions made with you: **a small Node server with a TTL cache**, and **AI categories only**.

## Files (all new, zero npm dependencies; Node 18+ for global `fetch`)
```
free-tier/
  server.js        # static file server + /api/data with an in-memory and on-disk TTL cache
  sources.js       # fetchAA(), fetchComparEdge(): fetch and normalize the data
  .env.example     # AA_API_KEY=, CACHE_TTL_HOURS=12, PORT=3000
  .gitignore       # .env, cache/
  public/
    index.html
    styles.css
    app.js
  README.md        # short: setup, run, attribution
```

## server.js
- Uses `node:http` only. Serves `public/` with correct MIME types and blocks path traversal (resolved path must stay inside `public/`).
- Loads `.env` with a tiny manual parser, so there is no dotenv dependency.
- `GET /api/data` returns `{ generatedAt, models: [...], services: [...], errors: [...] }`.
- Cache:
  - Keeps the response in memory and mirrors it to `cache/data.json`, so a restart doesn't use up the AA quota.
  - Serves the cache if it is younger than `CACHE_TTL_HOURS` (default 12h, which is about 2 AA calls a day).
  - If it is stale, it refreshes and **coalesces concurrent requests into one in-flight promise**.
  - If a refresh fails, it serves the stale cache and adds an `errors` entry. Sources are fetched independently with `Promise.allSettled`, so one failing source doesn't blank the other.
  - Sends a `Cache-Control: public, max-age=300` header so the browser helps too.
- If the AA key is missing, the page still shows ComparEdge data, with an error note.

## sources.js
- **`fetchAA(key)`** reads `json.data` and normalizes defensively with optional chaining to:
  - `{name, creator: model_creator?.name, input, output, blended, intelligence: evaluations?.artificial_analysis_intelligence_index, speed: median_output_tokens_per_second, url}`
  - **Free** means `input === 0 && output === 0`. The function returns the free models plus near-free ones (blended ≤ $0.10/1M) with a flag, so the UI can toggle.
- **`fetchComparEdge()`** runs a `Promise.all` over the AI categories: `llm, ai-coding, ai-image, ai-video, ai-voice, ai-agents, ai-writing, ai-assistants, ai-productivity`. That is 9 small requests per refresh. It dedupes by slug and keeps `{name, category, startingPrice, verifiedAt, url}`.
- Every fetch gets a 15s `AbortSignal.timeout`. If the response isn't JSON (for example a Cloudflare challenge page), it throws a clear error.

## Front end (public/)
- **index.html** has:
  - A header, a search box, and a "Models / Services" tab switch.
  - A category filter chip row for services.
  - A "include near-free" toggle for models.
  - Two tables, and a footer with **required attribution links** to Artificial Analysis and ComparEdge, plus the "data updated X ago" time.
- **app.js** (vanilla):
  - Fetches `/api/data` once and renders the rows.
  - Search and filters work client-side with no refetch.
  - Model table columns are name, creator, intelligence index, speed and price, sortable by clicking the header.
  - Service rows link to the ComparEdge pricing page.
  - Shows any `errors` as a small banner.
  - Uses `textContent` only, never `innerHTML` with API data, so there is no XSS.
- **styles.css** is about 150 lines:
  - CSS variables with light and dark support via `prefers-color-scheme`.
  - A system font stack and responsive tables (horizontal scroll inside the table wrapper, not the page).
  - No framework.

## Verification
1. Run `node server.js` without a key. Expected: the ComparEdge services render, an AA error banner shows, and `cache/data.json` gets written.
2. Add `AA_API_KEY` to `.env` and restart. Expected: models render. Then:
   - `curl -s localhost:3000/api/data | head` should work.
   - Hitting it repeatedly should make no new upstream calls. I'll add a log line on each upstream fetch to confirm.
3. Delete the in-memory cache by restarting. Expected: the server reads `cache/data.json` and makes no upstream call inside the TTL.
4. Fire 5 parallel curls against an expired cache. Expected: a single upstream fetch in the logs.
5. `curl localhost:3000/../server.js`. Expected: 404 (the traversal guard works).
6. Open the page in a browser. Check the search, tabs, sorting, near-free toggle, dark mode, a narrow viewport and the attribution footer.
