import express from "express";

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

const SUPPORTED_PROVIDERS = new Set(["claude", "chatgpt"]);

const MODEL_PRICING_USD_PER_MILLION = {
  chatgpt: {
    "gpt-4.1": { input: 2.0, output: 8.0 },
    "gpt-4.1-2025-04-14": { input: 2.0, output: 8.0 },
    "gpt-4.1-mini": { input: 0.4, output: 1.6 },
    "gpt-4.1-nano": { input: 0.1, output: 0.4 },
    "gpt-4o": { input: 2.5, output: 10.0 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 }
  },
  claude: {
    "claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0 },
    "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
    "claude-sonnet-4-5-20250929": { input: 3.0, output: 15.0 },
    "claude-3-5-haiku-20241022": { input: 0.8, output: 4.0 },
    "claude-3-opus-20240229": { input: 15.0, output: 75.0 }
  }
};

app.post("/api/run", async (req, res) => {
  const { kickoffPrompt, llm1, llm2 } = req.body || {};

  if (!kickoffPrompt || typeof kickoffPrompt !== "string") {
    return res.status(400).json({ error: "kickoffPrompt is required." });
  }

  const validationError = validateSetup(llm1, llm2);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  try {
    const result = await runConversation({ kickoffPrompt, llm1, llm2 });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Run failed." });
  }
});

app.post("/api/run/stream", async (req, res) => {
  const { kickoffPrompt, llm1, llm2 } = req.body || {};

  if (!kickoffPrompt || typeof kickoffPrompt !== "string") {
    return res.status(400).json({ error: "kickoffPrompt is required." });
  }

  const validationError = validateSetup(llm1, llm2);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  const writeEvent = (event) => {
    res.write(`${JSON.stringify(event)}\n`);
  };

  try {
    const result = await runConversation({
      kickoffPrompt,
      llm1,
      llm2,
      onTurn: ({ turn, turnsUsed }) => {
        writeEvent({ type: "turn", turn, turnsUsed });
      }
    });

    writeEvent({
      type: "done",
      turnsUsed: result.turnsUsed,
      usageTotals: result.usageTotals,
      cost: result.cost
    });
    return res.end();
  } catch (error) {
    writeEvent({ type: "error", error: error.message || "Run failed." });
    return res.end();
  }
});

async function runConversation({ kickoffPrompt, llm1, llm2, onTurn }) {
  const history = [`User: ${kickoffPrompt.trim()}`];
  const turns = [];
  const usageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  };
  let turns1 = 0;
  let turns2 = 0;
  let currentSpeaker = 1;
  let totalCostUsd = 0;
  let pricingKnownForAllTurns = true;

  while (turns1 < llm1.maxTurns || turns2 < llm2.maxTurns) {
    if (currentSpeaker === 1 && turns1 >= llm1.maxTurns) {
      currentSpeaker = 2;
      continue;
    }

    if (currentSpeaker === 2 && turns2 >= llm2.maxTurns) {
      currentSpeaker = 1;
      continue;
    }

    const active = currentSpeaker === 1 ? llm1 : llm2;
    const speakerName = currentSpeaker === 1 ? "LLM 1" : "LLM 2";
    const counterpartName = currentSpeaker === 1 ? "LLM 2" : "LLM 1";

    const result = await generateTurn({
      provider: active.provider,
      apiKey: active.apiKey,
      model: active.model,
      kickoffPrompt,
      history,
      speakerName,
      counterpartName
    });

    const text = result.text;
    const usage = normalizeUsage(result.usage);
    const turnCost = estimateTurnCostUsd({
      provider: active.provider,
      model: active.model,
      usage
    });

    history.push(`${speakerName}: ${text}`);
    const turn = {
      speaker: speakerName,
      provider: active.provider,
      model: active.model,
      text,
      usage,
      costUsd: turnCost.usd
    };
    turns.push(turn);

    usageTotals.inputTokens += usage.inputTokens;
    usageTotals.outputTokens += usage.outputTokens;
    usageTotals.totalTokens += usage.totalTokens;

    if (turnCost.known && typeof turnCost.usd === "number") {
      totalCostUsd += turnCost.usd;
    } else {
      pricingKnownForAllTurns = false;
    }

    if (currentSpeaker === 1) {
      turns1 += 1;
      currentSpeaker = 2;
    } else {
      turns2 += 1;
      currentSpeaker = 1;
    }

    if (onTurn) {
      onTurn({ turn, turnsUsed: { llm1: turns1, llm2: turns2 } });
    }
  }

  return {
    turns,
    turnsUsed: { llm1: turns1, llm2: turns2 },
    usageTotals,
    cost: {
      currency: "USD",
      totalUsd: totalCostUsd,
      estimated: true,
      complete: pricingKnownForAllTurns
    }
  };
}

function normalizeUsage(usage) {
  const inputTokens = Number(usage?.inputTokens || 0);
  const outputTokens = Number(usage?.outputTokens || 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens
  };
}

function estimateTurnCostUsd({ provider, model, usage }) {
  const pricing = resolvePricing(provider, model);
  if (!pricing) {
    return { known: false, usd: null };
  }

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.input;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;
  return { known: true, usd: inputCost + outputCost };
}

function resolvePricing(provider, model) {
  const catalog = MODEL_PRICING_USD_PER_MILLION[provider];
  if (!catalog || !model) {
    return null;
  }

  const normalizedModel = model.trim().toLowerCase();
  if (catalog[normalizedModel]) {
    return catalog[normalizedModel];
  }

  const prefixMatch = Object.entries(catalog).find(([name]) => normalizedModel.startsWith(name));
  return prefixMatch ? prefixMatch[1] : null;
}

function validateSetup(llm1, llm2) {
  if (!llm1 || !llm2) {
    return "llm1 and llm2 are required.";
  }

  for (const [index, llm] of [llm1, llm2].entries()) {
    const label = `llm${index + 1}`;
    if (!SUPPORTED_PROVIDERS.has(llm.provider)) {
      return `${label}.provider must be 'claude' or 'chatgpt'.`;
    }
    if (!llm.apiKey || typeof llm.apiKey !== "string") {
      return `${label}.apiKey is required.`;
    }
    if (!llm.model || typeof llm.model !== "string") {
      return `${label}.model is required.`;
    }
    if (!Number.isInteger(llm.maxTurns) || llm.maxTurns < 0 || llm.maxTurns > 20) {
      return `${label}.maxTurns must be an integer between 0 and 20.`;
    }
  }

  if (llm1.maxTurns === 0 && llm2.maxTurns === 0) {
    return "At least one model must have maxTurns > 0.";
  }

  return null;
}

async function generateTurn({
  provider,
  apiKey,
  model,
  kickoffPrompt,
  history,
  speakerName,
  counterpartName
}) {
  const systemPrompt = [
    `You are ${speakerName} in a conversation with ${counterpartName}.`,
    "Respond to the latest message naturally and continue the conversation.",
    "Keep replies concise (under 120 words) unless the user asks for detail."
  ].join(" ");

  const userPrompt = [
    "Kickoff prompt:",
    kickoffPrompt.trim(),
    "",
    "Conversation so far:",
    history.join("\n"),
    "",
    `Now write the next message as ${speakerName}.`
  ].join("\n");

  if (provider === "claude") {
    return callClaude({ apiKey, model, systemPrompt, userPrompt });
  }

  return callChatGPT({ apiKey, model, systemPrompt, userPrompt });
}

async function callClaude({ apiKey, model, systemPrompt, userPrompt }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data?.error?.message || data?.message || `Claude request failed (${response.status}).`;
    throw new Error(message);
  }

  const text = Array.isArray(data?.content)
    ? data.content.filter((part) => part.type === "text").map((part) => part.text).join("\n")
    : "";

  if (!text.trim()) {
    throw new Error("Claude returned an empty response.");
  }

  return {
    text: text.trim(),
    usage: {
      inputTokens: data?.usage?.input_tokens || 0,
      outputTokens: data?.usage?.output_tokens || 0
    }
  };
}

async function callChatGPT({ apiKey, model, systemPrompt, userPrompt }) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.8
    })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error?.message || `ChatGPT request failed (${response.status}).`;
    throw new Error(message);
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text || typeof text !== "string" || !text.trim()) {
    throw new Error("ChatGPT returned an empty response.");
  }

  return {
    text: text.trim(),
    usage: {
      inputTokens: data?.usage?.prompt_tokens || 0,
      outputTokens: data?.usage?.completion_tokens || 0
    }
  };
}

app.listen(port, () => {
  console.log(`LLM Discourses running at http://localhost:${port}`);
});
