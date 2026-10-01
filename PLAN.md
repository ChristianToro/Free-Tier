# Free-Tier AI Finder: lightweight page with a caching Node server

## Context
`/home/torosanctum/Next_Chapter/free-tier` has no code yet. The goal is a lightweight page (plain HTML/CSS/JS, no login) that shows which AI models and services have a free tier. The repo will be **public on GitHub and run locally** (no hosting for now).

It pulls from two sources, with these roles:
- **ComparEdge is the source of what is free.** `GET https://comparedge.com/api/v2/discover?hasFreeTier=true&category=<cat>&limit=200`
  - No key and CORS is open. `limit` is capped at 200 and there is no offset or page parameter, so fetch **one request per category**.
  - The response has top-level keys `count, total, query, results, schemaVersion`. Each result looks like `{slug, name, category, startingPrice, freeTier, verifiedAt, links.page}`.
  - The `llm` category returns about 20 **products**, not models: ChatGPT, Claude, Google Gemini, OpenAI API, Hugging Face, Groq, and others.
  - The old `comparedge-api.up.railway.app` host is dead.
- **Artificial Analysis (AA) only enriches LLM rows** with the intelligence index and output speed. `GET https://artificialanalysis.ai/api/v2/language/models/free`
  - We use a **Free key**, sent in the `x-api-key` header. The non-`/free` routes are Pro only and return **403** for Free keys.
  - The limit is **100 requests per fixed 24h window**, shared by every key on the same user or org. Response headers include `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `Retry-After` on a 429.
  - Results are paginated with `?page=N`. Loop while `pagination.has_more` is true. Expect about 2 pages, so **about 2 calls per refresh**.
  - Field paths are `name`, `slug`, `model_creator.name`, `evaluations.artificial_analysis_intelligence_index`, `performance.median_output_tokens_per_second`, and the top-level `intelligence_index_version`. The Free shape has **no blended price, license or open-weights fields**.
  - `null` means "not measured". It is **never 0 or free**.
  - Attribution to https://artificialanalysis.ai/ is required. Never call AA from the browser.
  - AA's Terms of Use and Data Platform Terms limit redistribution, so fetched data is **never committed**.

Decisions:
- A small Node server with a TTL cache.
- AI categories only on ComparEdge.
- AA covers LLMs only in v1. The AA media endpoints are listed in the README under "Future development plans".
- A hand-written map joins ComparEdge products to AA models.
- Stale rows are dimmed after 3 months.
- A public repo with a fake fixture file.

## Files (zero npm dependencies; Node 18+ for global `fetch`)
```
free-tier/
  server.js              # static file server + /api/data with an in-memory and on-disk TTL cache
  sources.js             # fetchAA(), fetchComparEdge(), join(): fetch, normalize, enrich
  aa-map.json            # hand-written: ComparEdge slug -> AA model slug (or null)
  fixtures/sample.json   # FAKE data in the /api/data shape, used when USE_FIXTURE=1
  .env.example           # AA_API_KEY=, CACHE_TTL_HOURS=12, PORT=3000, USE_FIXTURE=0
  .gitignore             # .env, cache/, node_modules/
  LICENSE                # MIT
  README.md              # setup, run, attribution, Future development plans
  public/
    index.html
    styles.css
    app.js
```

## server.js
- Uses `node:http` only. Serves `public/` with correct MIME types.
- Blocks path traversal. Decode the URL, resolve the path, and require it to stay inside `public/`. Otherwise return 404.
- Loads `.env` with a tiny manual parser, so there is no dotenv dependency.
- `GET /api/data` returns `{ generatedAt, aaIndexVersion, llms: [...], services: [...], errors: [...] }`.
- If `USE_FIXTURE=1`, it serves `fixtures/sample.json` and makes **no upstream calls**.
- Cache:
  - Keeps the response in memory and mirrors it to `cache/data.json`, so a restart doesn't use up the AA quota.
  - Writes the file **atomically**: write `data.json.tmp`, then `rename`.
  - Serves the cache if it is younger than `CACHE_TTL_HOURS` (default 12h, which is about 4 AA calls a day).
  - If it is stale, it refreshes and **coalesces concurrent requests into one in-flight promise**.
  - Sources are fetched independently with `Promise.allSettled`. If one source fails, the server keeps that source's last good data and adds an `errors` entry.
  - **Backoff:** after a failed refresh, it doesn't retry until a `nextRetryAt` time. For an AA 429, that time comes from `Retry-After` or `X-RateLimit-Reset`. For other failures it is 15 minutes. Without this, every page view during an outage would spend quota.
  - Logs `X-RateLimit-Remaining` after each AA call.
  - Sends a `Cache-Control: public, max-age=300` header.
- If the AA key is missing, LLM rows still render from ComparEdge with the scores shown as "—", plus an error note.
- **Cold start with no cache and upstream down:** it returns `llms: [], services: []` plus `errors`, and the UI shows an explicit empty state.

## sources.js
- **`fetchAA(key)`** loops over the pages and returns a `Map` of `slug -> {name, creator, intelligence, speed}` plus `intelligence_index_version`. Normalization is defensive and uses optional chaining.
- **`fetchComparEdge()`** runs a `Promise.all` over `llm, ai-coding, ai-image, ai-video, ai-voice, ai-agents, ai-writing, ai-assistants, ai-productivity`. It dedupes by slug and keeps `{slug, name, category, startingPrice, freeTier, verifiedAt, url}`. If any category returns exactly 200 results, it adds a "possibly truncated" warning to `errors`.
- **`join(ce, aa, map)`** handles the `llm` category rows:
  - It looks up `aa-map.json[slug]`. If there is a match, it attaches `{aaModelName, intelligence, speed}`.
  - The row shows **which AA model the scores come from**, for example "Scores: GPT-5 mini". This matters because a product's free tier may not use its best model.
  - A slug that is missing from the map, or a mapped AA slug that isn't in AA's data, is logged as a warning so the map gets updated.
  - A mapping of `null` (for platforms like Hugging Face, Replicate or Groq) means "no single model" and shows "—".
  - A mapping to an **array of AA slugs** means the product offers several free models. The row then gets a `models: [{name, intelligence, speed}]` array (its own scores stay `null`), and the UI shows one indented sub-row per model. The product sorts by its best model. A one-element array is treated like a single slug.
- Every fetch gets a 15s `AbortSignal.timeout`. If the response isn't JSON (for example a Cloudflare challenge page), it throws a clear error.

## aa-map.json
- A flat object keyed by ComparEdge slug, for example `{ "chatgpt": "<aa-slug>", "groq": ["<aa-slug>", "<aa-slug>"], "hugging-face": null, ... }`.
- Each value is an AA slug, an array of AA slugs (several free models), or `null`. Any other value logs a warning and is treated as `null`.
- Written by hand once from the live lists, and reviewed when the server logs a warning.
- Each value should be the model the product's **free tier** actually gives, not its flagship model.

## Front end (public/)
- **index.html** has:
  - A header, a search box, and an "LLMs / Other AI services" tab switch.
  - A category filter chip row for services.
  - Tables for each tab.
  - An error banner and an empty state.
  - A footer with **required attribution links** to Artificial Analysis and ComparEdge, the "data updated X ago" time, and the AA intelligence index version.
- **app.js** (vanilla):
  - Fetches `/api/data` once and renders the rows.
  - Search and filters work client-side.
  - LLM columns are product, free tier, starting price, intelligence (with a "Scores: <AA model>" subtitle), speed, and verified. They are sortable by clicking the header, and nulls always sort last.
  - Service columns are name, category, free tier, starting price, and verified.
  - Every row shows **"verified X ago"**. Rows with `verifiedAt` older than **3 months** are dimmed and have a tooltip ("may be out of date").
  - Rows link to the ComparEdge page.
  - Uses `textContent` only, never `innerHTML` with API data.
- **styles.css** is about 150 lines:
  - CSS variables with light and dark support via `prefers-color-scheme`.
  - A system font stack and a responsive table wrapper with horizontal scroll inside the wrapper, not the page.
  - A `.stale` class for dimmed rows.

## Repo hygiene (public GitHub)
- Run `git init` before the first commit and check `.gitignore` first. `.env` and `cache/` must never be committed.
- `fixtures/sample.json` contains **invented** products and numbers. Each entry's name is prefixed "Example" so it can't be mistaken for real AA or ComparEdge data.
- MIT license.

## README.md
- Setup covers three things:
  - Copy `.env.example` to `.env`.
  - Get a free AA key.
  - Run `USE_FIXTURE=1 node server.js` to try the page without a key.
- A run section.
- Attribution to both sources.
- A quota note: 100 requests a day, and the cache keeps a refresh to about 2 AA calls.
- **Future development plans:**
  - AA media `/free` endpoints: text-to-image, image-editing, text-to-video, image-to-video (with and without audio), text-to-speech, speech-to-speech, speech-to-text, and music (instrumental and with vocals).
  - Hosting (a static host with a scheduled build).

## Verification
1. Run `USE_FIXTURE=1 node server.js`. Expected: both tabs render from the fixture, no upstream calls are logged, a stale fixture row is dimmed, and the attribution footer shows.
2. Run `node server.js` without a key. Expected: services and LLM rows render from ComparEdge with scores shown as "—", an AA error banner shows, and `cache/data.json` gets written.
3. Add `AA_API_KEY` and restart. Expected: LLM rows show intelligence and speed, and the log shows about 2 AA calls with `X-RateLimit-Remaining`. Unmapped slugs are logged.
4. Hit `/api/data` repeatedly. Expected: no new upstream calls. Then restart. Expected: the server reads `cache/data.json` and makes no upstream call inside the TTL.
5. Fire 5 parallel curls against an expired cache. Expected: a single upstream fetch.
6. Simulate a failure (bad key or offline) with a stale cache. Expected: stale data plus an error, and repeated requests make **no** new upstream attempts until `nextRetryAt`.
7. Test the traversal guard. Both of these should return 404:
   - `curl --path-as-is localhost:3000/../server.js`
   - `curl localhost:3000/%2e%2e/server.js`
8. Open the page in a browser. Check search, tabs, sorting (nulls last), the stale dimming and its tooltip, dark mode, a narrow viewport, and the footer.
9. Before pushing, run `git status`. Expected: no `.env` and no `cache/`.
