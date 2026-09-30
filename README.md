# Free-Tier AI Finder

A lightweight page (no login) that lists AI models and services with a **free
tier**. A tiny Node server fetches and caches the data, then serves a plain
HTML/CSS/JS page.

- [ComparEdge](https://comparedge.com) decides what is free (`hasFreeTier=true`).
- [Artificial Analysis](https://artificialanalysis.ai/) adds the intelligence
  index and output speed to LLM rows. Each row names the model its scores come
  from, joined through the hand-written [`aa-map.json`](aa-map.json).

Node 18+ and no npm dependencies.

## Setup

1. Copy `.env.example` to `.env`.
2. Get a free Artificial Analysis API key at https://artificialanalysis.ai/ and
   set `AA_API_KEY` in `.env`. Without a key the page still works, and scores
   show as "—".
3. To try the page with no key and no network, run it with the fake fixture:

   ```sh
   USE_FIXTURE=1 node server.js
   ```

## Run

```sh
node server.js
```

Then open http://localhost:3000. Settings (in `.env` or the environment):

| Variable          | Default | Meaning                                            |
| ----------------- | ------- | -------------------------------------------------- |
| `AA_API_KEY`      | —       | Artificial Analysis Free-tier key                  |
| `CACHE_TTL_HOURS` | `12`    | Hours before cached data is refetched              |
| `PORT`            | `3000`  | Port to listen on                                  |
| `USE_FIXTURE`     | `0`     | `1` serves `fixtures/sample.json`, no upstream calls |

Fetched data is cached in memory and in `cache/data.json`, so a restart does
not spend quota. `cache/` is git-ignored and must never be committed.

## Quota

The Artificial Analysis Free tier allows **100 requests per 24 hours**. One
refresh pages through the free model list, which is currently about 4 calls.
With the default 12-hour cache that is about 8 calls a day. After a failed
refresh the server waits (15 minutes, or until the rate-limit reset on a 429)
before trying again.

## Updating `aa-map.json`

`aa-map.json` maps each ComparEdge LLM slug to the Artificial Analysis model
slug that the product's **free tier** actually uses, not its flagship model.
`null` means there is no single model (for example Hugging Face or Groq). The
server logs a warning for slugs that are missing from the map, or mapped to a
model Artificial Analysis no longer lists.

## Attribution

- LLM scores: [Artificial Analysis](https://artificialanalysis.ai/)
- Free-tier and pricing data: [ComparEdge](https://comparedge.com)

`fixtures/sample.json` contains invented data only, and every name in it starts
with "Example".

## Future development plans

- Artificial Analysis media `/free` endpoints: text-to-image, image editing,
  text-to-video, image-to-video (with and without audio), text-to-speech,
  speech-to-speech, speech-to-text, and music (instrumental and with vocals).
- Hosting (a static host with a scheduled build).

## License

[MIT](LICENSE)
