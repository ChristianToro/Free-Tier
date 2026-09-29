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
