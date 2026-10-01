# Prompt History

This document records meaningful development interactions between the user and
AI coding agents working on this project. It focuses on requests, outcomes,
implementation decisions, verification, and human-agent collaboration rather
than preserving a raw conversation transcript.

Generated code is included verbatim when reasonably concise. Extensive
implementations are referenced through their canonical repository files.

> This file is an engineering collaboration record, not a source of truth for
> application behavior. The repository itself remains authoritative.

---

## Session: 2026-09-29

**Objective:** Plan a lightweight HTML/CSS/JS page that lists free AI models and
services using the Artificial Analysis and ComparEdge APIs, with cached API calls
and no login.

### Interaction 1 — Research both APIs and draft the plan

**User Prompt**

> I want to create a lightweight webpage, JS, CSS, HTML. The goal is to display
> via api calls from Artificialanalysis, comparedge, which models, services are
> free. No login, cached api calls to reduce usage.

**Agent Outcome**

The session ran in plan mode, so no code was written. The project directory was
empty. Research findings:

- **Artificial Analysis:** `GET /api/v2/data/llms/models` needs an `x-api-key`
  header and allows 1,000 requests a day. Its docs say to cache responses, not
  to call it from the browser, and to credit https://artificialanalysis.ai/.
  Pricing fields are `price_1m_input_tokens`, `price_1m_output_tokens` and
  `price_1m_blended_3_to_1`. Found from the docs only; the response format was
  not seen live because no key was available.
- **ComparEdge**, checked live with curl:
  - `https://comparedge.com/api/v2/discover?hasFreeTier=true` works with no key
    and sends `Access-Control-Allow-Origin: *`.
  - It returned 317 free-tier products across 24 categories.
  - `limit` is capped at 200, and `offset` and `page` are ignored. Full coverage
    therefore needs one request per `category`.
  - Each result looks like `{slug, name, category, startingPrice, freeTier,
    verifiedAt, links.page}`.
  - The host listed in search results, `comparedge-api.up.railway.app`, returns
    404 ("Application not found").
  - The bare `/api/v2` index path returned a Cloudflare challenge page.

**Rationale**

Artificial Analysis needs a key and has a daily quota, so it has to be called
from a server that caches results, not from the browser. The ComparEdge cap on
results per request is the reason for fetching each category separately.

**Collaboration**

The agent offered three caching options and two scopes. The user chose:

- **A tiny Node server with a TTL cache.** The agent had recommended a script
  that writes a static `data.json` instead.
- **AI categories only**, which the agent had recommended.

### Interaction 2 — Save the plan as PLAN.md; planning only this session

**User Prompt**

> Write this plan onto a PLAN.md file at root. That is all we are going to do
> this session

**Agent Outcome**

The user turned down leaving plan mode to start building. The plan was copied to
`PLAN.md` in the project root. The planned design:

- `server.js` uses `node:http` with no dependencies. It serves `public/` and
  `/api/data`.
- The cache lives in memory and in `cache/data.json`, with a default 12h TTL.
  Simultaneous refreshes share one fetch, and a failed refresh serves the last
  good data.
- `sources.js` fetches and normalizes both sources, calling ComparEdge once for
  each of 9 AI categories.
- A model counts as "free" when its input and output prices are both $0. A
  toggle can also show near-free models.
- The front end is vanilla HTML/CSS/JS with search, tabs, sorting, dark mode and
  footer credits for both sources.

**Changes**

- [`PLAN.md`](PLAN.md) — created; full implementation plan and verification steps.

**Verification**

None. This was a planning step and no application code exists yet.

**Collaboration**

The user limited the session to planning. Building the app is deferred to a
future session, working from `PLAN.md`.

### Session Summary

**Completed**

- API research and a written plan in [`PLAN.md`](PLAN.md).

**Key Decisions**

- A Node server with a TTL cache, chosen by the user, keeps the Artificial
  Analysis key on the server and stays within its quota.
- The scope is AI categories only, chosen by the user.
- ComparEdge is fetched one category at a time because of its 200-result cap.

**Open Items**

- Build the app as described in `PLAN.md`.
- Check the Artificial Analysis response format against a real API key.
- The project has no `CLAUDE.md` asking for this history to be kept, so add one
  if the log should continue automatically.

---

## Session: 2026-09-29 — Plan review (grilling)

**Objective:** Check whether `PLAN.md` is enough to start building, find what is
missing, and settle the open design decisions before any code is written.

### Interaction 1 — Check the plan against the Artificial Analysis spec

**User Prompt**

> is this planning document here in this folder sufficient to begin developing a
> webpage. What is missing? What pitfalls were not addressed?

**Agent Outcome**

The overall design held up: a Node server with a TTL cache, one shared fetch
for simultaneous requests, `Promise.allSettled`, and rendering with
`textContent`. Checking the Artificial Analysis section against
`../artificial-analysis-openapi.yaml` found errors that would have broken it on
the first run:

- **Wrong endpoint.** `/api/v2/data/llms/models` doesn't exist. Free keys must
  use `/api/v2/language/models/free`, because the other routes are Pro only and
  return 403.
- **Wrong quota.** The limit is 100 requests per fixed 24-hour window on Free
  (500 on Pro), shared by every key on the account, not 1,000.
- **Wrong field paths.** Prices sit under `pricing.*` and speed under
  `performance.*`. The Free response has no blended price, license, or
  open-weights fields.
- **No paging.** The results are paginated (`page`, `pagination.has_more`), and
  the plan fetched only the first page.

Logic pitfalls the plan did not cover:

- A missing price is `null`, and in JavaScript `null <= 0.1` is true, so
  unpriced models would have been flagged "near-free".
- Artificial Analysis prices are paid list prices, so a "$0 models" list could
  come back empty.
- After a failed refresh, every page view would try again and use up the quota.
- ComparEdge caps each category at 200 results, so a category returning exactly
  200 may be silently cut off.
- No behavior was defined for a first start with no cache while an API is down.
- The cache file was not written atomically.
- `curl` cleans up `../` on its own, so the path-traversal check never reached
  the server. It needs `--path-as-is`.

**Collaboration**

Round 1 of questions, with the user's answers:

- **Q1 Artificial Analysis tier:** a Free key.
- **Q2 What counts as a free model:** the user moved away from Artificial
  Analysis prices. Free LLM access now comes from ComparEdge's `llm` category,
  and Artificial Analysis is used only for the intelligence and speed scores.
- **Q3 Scope:** LLMs only for v1. The Artificial Analysis media endpoints go in
  a "Future development plans" section of the README.
- **Q4 Hosting:** a public GitHub repo, run locally for now.

### Interaction 2 — Join the two sources, and repo hygiene

**Agent Outcome**

A live call to ComparEdge's `llm` category returned 20 entries, and they are
**products, not models**: ChatGPT, Claude, Google Gemini, Hugging Face, Groq,
Grok 2, Phi-3, and others. Artificial Analysis rows are specific model
versions, so matching them by name would not work.

**Collaboration**

Round 2 of questions, with the user's answers:

- **Q5 Joining the sources:** a hand-written `aa-map.json` that maps each
  ComparEdge slug to one Artificial Analysis model slug, or `null` for platforms
  with no single model.
- **Q6 Non-LLM ComparEdge categories:** kept. The "LLMs only" limit applies to
  Artificial Analysis.
- **Q7 Out-of-date entries:** each row shows "verified X ago", and rows older
  than 3 months are dimmed.
- **Q8 Repo:** public, with `cache/` gitignored, the key kept in `.env`, and a
  fake fixture file for early testing.

### Interaction 3 — Update the plan

**User Prompt**

> adjust these

**Agent Outcome**

`PLAN.md` was rewritten with all eight decisions. `CLAUDE.md` still gave the old
endpoint, quota, and $0 free rule, so it was corrected to match.

**Changes**

- [`PLAN.md`](PLAN.md) — rewritten:
  - The correct Artificial Analysis endpoint, a loop over every results page,
    and `null` treated as "unknown".
  - `aa-map.json`. Each LLM row names the Artificial Analysis model its scores
    come from, and slugs missing from the map are logged.
  - "LLMs" and "Other AI services" tabs.
  - Rows older than 3 months are dimmed.
  - `USE_FIXTURE=1` serves `fixtures/sample.json`.
  - After a failed refresh, the server waits for `Retry-After` or
    `X-RateLimit-Reset` before trying again.
  - Atomic cache writes, an empty state for a cold start, and a warning when a
    category may be cut off.
  - An MIT license, a README with "Future development plans", and 9
    verification steps.
- [`CLAUDE.md`](CLAUDE.md) — corrected the Artificial Analysis endpoint, the
  quota, pagination, and the definition of "free".

**Verification**

None. This was planning only, and no application code exists yet.

### Interaction 4 — Archive the original plan

**User Prompt**

> I want to have a md file within this project titled PLAN_phase_0.md to show
> what the plan looked like before the grilling session made the changes.

**Changes**

- [`PLAN_phase_0.md`](PLAN_phase_0.md) — created. It is the original
  `PLAN.md` word for word, rebuilt from the copy read at the start of the
  session because the project has no git history. A short note at the top marks
  it as an outdated snapshot.

### Session Summary

**Completed**

- Reviewed the plan and fixed the Artificial Analysis details that were wrong.
- Archived the original plan as `PLAN_phase_0.md`.
- Settled 8 design decisions over two rounds of questions.
- Updated `PLAN.md` and `CLAUDE.md`.

**Key Decisions**

- ComparEdge decides what is free. Artificial Analysis only adds scores to LLM
  rows, joined through the hand-written `aa-map.json`.
- The Artificial Analysis Free tier and its `/free` endpoint, which allows 100
  requests a day and costs about 2 calls per refresh.
- A public repo that never commits fetched data, with a fake fixture file so
  the page runs without a key.

**Open Items**

- Build the app from `PLAN.md`.
- Fill in `aa-map.json` from the live model lists once an Artificial Analysis
  key is available.
- Check the Artificial Analysis Free response format against a real key.

---

## Session: 2026-09-29 — Implementation

**Objective:** Build the app from `PLAN.md` in six milestones: repo scaffold,
`server.js`, `sources.js`, `aa-map.json`, `app.js`, `styles.css`.

### Interaction 1 — Start implementation in milestones

**User Prompt**

> We will now begin coding. Use the plan.md as the source of truth for the
> structure, logic, and development. Stay within scope. The AA key is safely
> stored in .env: do not expose it.
>
> Break up the work into milestones: 1)scaffold of repo architecure,
> 2)server.js, 3)sources.js, 4)map.json file structure, 5)app.js, 6)styles.css

Follow-up: "and use the prompt history skill"

**Agent Outcome**

All six milestones are implemented, and every server-side check in
`PLAN.md` § Verification was run except step 8 (browser). Nothing was
committed.

Findings that shaped the code:

- `.env` stores the key as `x-api-key=<redacted>`, while `PLAN.md` and
  `.env.example` use `AA_API_KEY`. `.env` was left untouched. For testing, the
  value was passed through the environment without being printed. The server
  reads only `AA_API_KEY`, so the user needs to rename the variable.
- The Artificial Analysis Free list is **4 pages (684 models)**, not the ~2 the
  plan expected. A refresh costs about 4 calls, or about 8 a day at the
  default 12h TTL. `README.md` and `CLAUDE.md` now say this.
- ComparEdge `freeTier` is a boolean `true`, not a description, and
  `startingPrice` is a number or `null`. The UI shows "Yes" and "$N".
- The `prompt-history` skill (`~/.claude-personal/skills/prompt-history`) has
  `disable-model-invocation: true`, so it was followed by hand.

**Implementation**

- [`server.js`](server.js): `loadEnv()`, `getData()`, `refresh()`,
  `buildPayload()`, `saveCacheFile()` (tmp + rename), `serveStatic()`.
- [`sources.js`](sources.js): `fetchAA()`, `fetchComparEdge()`, `join()`,
  `getJSON()` (15s timeout, clear error for non-JSON replies), `retryTime()`.
- [`aa-map.json`](aa-map.json): 14 of the 20 ComparEdge LLM slugs map to an
  Artificial Analysis model. `openai-api`, `claude-api`, `hugging-face`,
  `replicate`, `groq` and `phi-3-medium` are `null`. Artificial Analysis lists
  Phi-3 Mini only, so there is no exact match for Phi-3 Medium.
- [`public/app.js`](public/app.js), [`public/index.html`](public/index.html),
  [`public/styles.css`](public/styles.css).

**Rationale**

- The cache and backoff are tracked **per source** (`fetchedAt`,
  `nextRetryAt`, `error` for each of `aa` and `ce`). A failure in one source
  never re-spends quota on the other or blanks its data. This refines the
  plan's single cache without changing its behavior.
- A missing key skips the AA fetch entirely rather than counting as a failure,
  so it never triggers backoff.
- Map warnings are logged once per process, because `join()` runs on every
  request.
- The front end only links to `http(s)` URLs, so a bad `url` value from the API
  can't produce a `javascript:` link.

**Changes**

- Created: `server.js`, `sources.js`, `aa-map.json`, `fixtures/sample.json`
  (invented "Example" rows, two of them stale), `.env.example`, `LICENSE`
  (MIT), `README.md`.
- Filled in (previously empty): `public/index.html`, `public/app.js`,
  `public/styles.css`.
- `.gitignore`: added `cache/` and `node_modules/`.
- `CLAUDE.md`: status now "v1 implemented", commands are no longer "planned",
  and the AA page count is noted.

**Verification**

Servers were run on ports 3101–3106 and checked with curl:

1. Fixture mode: 5 LLMs and 7 services, no upstream calls logged, no `cache/`
   written.
2. No key: 20 LLMs and 79 services from ComparEdge, scores `null`, an AA error
   in `errors`, and `cache/data.json` written. Three requests caused one
   refresh.
3. With the key: 4 AA calls (`X-RateLimit-Remaining` went from 95 to 92),
   version 4.3, all 14 mapped rows scored, and no map warnings. The key did not
   appear in the logs or in `cache/data.json`.
4. After a restart, the server loaded `cache/data.json` and made no upstream
   call.
5. With an expired TTL, 5 parallel requests caused one ComparEdge refresh.
6. With `fetch` stubbed to fail and a stale cache, 4 requests caused one
   attempt. The stale data was served with both errors, and the next retry was
   set 15 minutes out. A cold start while offline returned empty `llms` and
   `services` plus the errors.
7. Traversal: `/../server.js`, `/%2e%2e/server.js`, `/..%2fserver.js`,
   `/%2e%2e%2f.env`, `/%00` and malformed escapes all returned 404. `POST`
   returned 405.
8. **Not done:** there was no browser in this session to check the page
   visually.
9. `git status`: `.env` and `cache/` are ignored. The test cache was deleted
   afterwards.

Also run: `node --check` on all three JS files.

**Collaboration**

The user set the six-milestone order, made `PLAN.md` the source of truth, and
required that the key not be exposed. The key-name mismatch was reported back
instead of `.env` being edited. The `aa-map.json` values are the agent's best
guesses at each product's free-tier model and need the user's review.

### Interaction 2 — Commit per milestone

**User Prompt**

> one commit per milestone

**Agent Outcome**

Made six milestone commits, plus one for `CLAUDE.md` and this file, on a new
branch `v1-implementation` (off `main` at `4442f06`). `.env`, `.claude/` and
`cache/` stay ignored. Not pushed.

**Open Items**

- Merge `v1-implementation` into `main` when reviewed.
- Rename `x-api-key=` to `AA_API_KEY=` in `.env`.
- Review the `aa-map.json` values (for example ChatGPT → GPT-5.5 Instant, and
  Claude → Sonnet 5.5 medium effort).
- Browser check (step 8): search, tabs, sorting, stale rows, dark mode, narrow
  viewport.

---

## Session: 2026-09-30

**Objective:** Let `aa-map.json` map one ComparEdge product to several free AA models.

### Interaction 1 — Multi-model entries in aa-map.json

**User Prompt**

> I am manually asjusting the aa-map file. Some platforms have multiple models
> offered free, so have inadvertantly labeled null. could the comparedge slug
> accommodate nested objects?

**Agent Outcome**

Yes. A map value can now be an AA slug, an **array of AA slugs**, or `null`,
for example `"groq": ["llama-4-maverick", "qwen3-32b"]`. For a product with two
or more models, `join()` adds `models: [{name, intelligence, speed}]` to the row
and leaves its own scores `null`. The UI shows the product row with
"Scores: see models below", then one indented `└ <model>` sub-row per model.
Strings, `null` and one-element arrays behave exactly as before.

**Rationale**

- A flat array was chosen over `{ models: [...], note }` objects because it's
  less to hand-write, and AA already supplies each model's display name.
- A multi-model product sorts by its best model's score (`sortValue()`), so it
  ranks by what its free tier can do, and nulls still sort last. Sub-rows are
  sorted by the active score column, or by intelligence otherwise.
- A slug AA doesn't list is kept as a sub-row with its slug as the name and
  "—" scores, and a warning is logged. Values of any other type log a warning
  and are treated as `null`.
- `join()` runs on every request, so no cache change or extra AA quota is
  needed.

**Changes**

- [`sources.js`](sources.js): new `mapSlugs()` and `aaModel()` helpers, and
  `join()` emits `models` for multi-model rows.
- [`public/app.js`](public/app.js): `sortValue()`, `modelRows()`, `llmRow()`
  now returns an array (the product row plus sub-rows), search also matches
  model names, and the product count excludes sub-rows.
- [`public/styles.css`](public/styles.css): `tr.has-models`, `tr.child` and
  `tr.child.end` styles.
- [`fixtures/sample.json`](fixtures/sample.json): "Example Model Hub" now has 3
  invented models, one of them unscored.
- `PLAN.md`, `README.md`, `CLAUDE.md`: describe the array form.
- `aa-map.json`: not touched. The user is editing it by hand.

**Verification**

- `node --check` passes on all three JS files, and the fixture parses.
- A `node -e` test of `join()` with fake data covered a string, `null`, a
  one-element array, a 3-element array with an unlisted slug, a number, a
  missing slug, and AA unavailable. It gave the expected shapes and 3
  warnings.
- `app.js` was run against a stub DOM in a scratch script. The sub-rows render
  under their product in both intelligence-desc and speed-asc sort, the
  search "open 8b" finds the product, and the count is 5 products.
- `USE_FIXTURE=1` server on port 3107: `/api/data` returns `models` (3 of them)
  on the hub row, and the other rows are unchanged.
- The user's current `aa-map.json` (20 entries, no arrays yet) passes the new
  checks.
- **Not done:** a visual browser check of the sub-row styling.

**Collaboration**

The user chose one sub-row per model (over "best model only" or a combined
subtitle) and a flat array (over nested objects with labels).

### Interaction 2 — Commit

**User Prompt**

> commit these changes

**Agent Outcome**

Committed the multi-model change on `v1-implementation`. The user's
hand-edited `aa-map.json` was left unstaged, since it is their own in-progress
work and not part of this change. Commit `629231a`. Not pushed.

### Interaction 3 — Chips visible on the LLM tab

**User Prompt**

> There is a rendering bug:
>
> when the server is started, the chips div is still present while the LLM tab
> is selected even though `chips.hidden = state.tab !== 'services' || ...`
> attempts to hide them.

**Agent Outcome**

The JS was correct. The bug was in the CSS: `.chips { display: flex }` overrode
the browser's built-in `[hidden] { display: none }`, because page styles take
priority over built-in ones. Fixed with one global rule in
[`public/styles.css`](public/styles.css):

```css
/* Keep the hidden attribute working on elements that set display (e.g. .chips) */
[hidden] { display: none !important; }
```

**Rationale**

A global rule was used instead of `.chips[hidden]`, so every element toggled
with `hidden` (banner, panels, empty state, status) stays safe if it later sets
`display`.

**Verification**

- Every `hidden` use in `public/` is meant to hide; none relies on showing a
  hidden element.
- A fixture server on port 3108 served `styles.css` with the new rule.
- **Not done:** a visual browser check (no browser in the session).

Committed on request ("commit these changes"); `aa-map.json` again left
unstaged. Not pushed.
