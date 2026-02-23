# LLM Discourses

Let two LLMs talk to each other from a single kickoff prompt. Pick any combination of Claude and ChatGPT models, set the number of turns for each, and watch the conversation unfold in real time.

## Setup

```
npm install
```

You'll need API keys for whichever providers you want to use:

- **Claude** - [Anthropic API key](https://console.anthropic.com/)
- **ChatGPT** - [OpenAI API key](https://platform.openai.com/)

## Usage

```
npm start
```

Open [http://localhost:3000](http://localhost:3000), configure both LLMs (provider, model, API key, max turns), enter a kickoff prompt, and hit **Start Conversation**.

Turns stream in live via NDJSON. When the session finishes you get a cost estimate and can download the full transcript as Markdown.

## API

### `POST /api/run/stream`

Streams turns as newline-delimited JSON. Request body:

```json
{
  "kickoffPrompt": "Debate whether tabs or spaces are better.",
  "llm1": { "provider": "chatgpt", "model": "gpt-4.1", "apiKey": "sk-...", "maxTurns": 3 },
  "llm2": { "provider": "claude", "model": "claude-sonnet-4-5", "apiKey": "sk-ant-...", "maxTurns": 3 }
}
```

### `POST /api/run`

Same payload, returns the full result in one response instead of streaming.

## Supported Models

Pricing is tracked for cost estimates. Any model string the provider accepts will work — models without a pricing entry just won't show a cost.

| Provider | Models with pricing |
|----------|-------------------|
| ChatGPT  | gpt-4.1, gpt-4.1-mini, gpt-4.1-nano, gpt-4o, gpt-4o-mini |
| Claude   | claude-sonnet-4-5, claude-3-5-sonnet, claude-3-5-haiku, claude-3-opus |
