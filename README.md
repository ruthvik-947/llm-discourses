# LLM Discourses

Let up to four LLMs talk to each other from one kickoff prompt. Pick any models OpenRouter supports, pick how many rounds, and watch the conversation stream in.

## Run it

It's a single static HTML file — no build, no server, no install.

```
open index.html
```

…or serve it locally if your browser dislikes `file://`:

```
python3 -m http.server 8000
```

then visit `http://localhost:8000`.

## Setup

You'll need an [OpenRouter API key](https://openrouter.ai/keys). Paste it into the page; it's stored in your browser's `localStorage` and sent only to OpenRouter.

## How it works

- The page fetches OpenRouter's model list on load. Type into a model field to filter (`opus`, `gpt-5`, `deepseek`…).
- Add up to four participants. Each round, every active participant speaks once, in order. 4 participants × 3 rounds = 12 turns.
- Per-token pricing comes from OpenRouter's models endpoint, so cost estimates stay accurate without any maintenance here.
- Turns stream token-by-token via Server-Sent Events.
- When the run finishes, you can download the full transcript as Markdown.

## Hosting

Drop `index.html` on any static host — GitHub Pages, Netlify, Cloudflare Pages, an S3 bucket, your home server. There is no backend.

## Acknowledgements

Routing, model availability, and pricing courtesy of [OpenRouter](https://openrouter.ai). API access billed to your OpenRouter account.
