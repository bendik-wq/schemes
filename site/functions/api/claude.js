// Cloudflare Pages Function: POST /api/claude
// Claude-drevne lead magnets på VSL-sidene (hooks, byggeplan, healthspan-snapshot).
//
// Cloudflare → Pages → Settings → Variables and Secrets:
//   ANTHROPIC_API_KEY  (secret, påkrevd)
//   WEBHOOK_URL        (valgfri) e-post + svar sendes videre som lead
// Valgfritt KV-binding LEADS: brukes til enkel rate limiting per IP.

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5-5";
const MAX_FIELD = 600; // tegn per felt, holder kostnad og misbruk nede
const RATE_LIMIT = 5; // generasjoner per IP per time (krever LEADS-KV)

const TOOLS = {
  hooks: {
    system:
      "You are a senior short-form content strategist for founders and experts. " +
      "Write hooks that sound like a real person talking, specific to the niche and audience given. " +
      "No hashtags, no emojis, no income or results claims, no clickbait lies.",
    prompt: (i) =>
      `Role: ${i.role}\nIndustry / niche: ${i.niche}\nWho buys from them: ${i.audience}\n` +
      `Their strongest opinion or expertise: ${i.angle || "not given"}\n\n` +
      "Create a positioning line, 5 short-form video hooks (first 3 seconds, max 14 words each) " +
      "and 3 video ideas with a one-sentence outline each.",
    schema: {
      type: "object",
      properties: {
        positioning: { type: "string" },
        hooks: { type: "array", items: { type: "string" } },
        ideas: {
          type: "array",
          items: {
            type: "object",
            properties: { title: { type: "string" }, outline: { type: "string" } },
            required: ["title", "outline"],
            additionalProperties: false,
          },
        },
      },
      required: ["positioning", "hooks", "ideas"],
      additionalProperties: false,
    },
    fields: ["role", "niche", "audience", "angle"],
    required: ["role", "niche", "audience"],
  },

  "build-plan": {
    system:
      "You are a senior engineer who teaches non-technical founders to build internal software with " +
      "Claude Code, an agentic coding tool. Produce realistic, plain-English build plans for a small " +
      "internal tool. Prefer simple stacks (static front end, serverless functions, a managed database). " +
      "Always include security considerations (auth, secrets, data access). Never promise a timeline " +
      "shorter than is realistic.",
    prompt: (i) =>
      `Company type: ${i.company}\nThe tool they want: ${i.tool}\nWho will use it: ${i.users}\n` +
      `Systems it must connect to: ${i.systems || "none given"}\n\n` +
      "Write a build plan: a short name, a one-sentence summary, the main components, a step-by-step " +
      "plan for Build Day 1 and Build Day 2, an estimate in build days for a founder working with " +
      "Claude Code plus a reviewing engineer, and the top risks.",
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        summary: { type: "string" },
        components: { type: "array", items: { type: "string" } },
        day1: { type: "array", items: { type: "string" } },
        day2: { type: "array", items: { type: "string" } },
        estimate_days: { type: "integer" },
        risks: { type: "array", items: { type: "string" } },
      },
      required: ["name", "summary", "components", "day1", "day2", "estimate_days", "risks"],
      additionalProperties: false,
    },
    fields: ["company", "tool", "users", "systems"],
    required: ["company", "tool", "users"],
  },

  healthspan: {
    system:
      "You are a strength and conditioning coach working alongside physicians in a longevity program. " +
      "You give general fitness and lifestyle guidance only. You do not diagnose, do not mention " +
      "medications, supplements or doses, and do not interpret symptoms. If the person reports pain, " +
      "chest symptoms, dizziness, recent injury or surgery, tell them to see a physician before " +
      "starting anything and keep suggestions gentle. Be encouraging and specific, never alarmist.",
    prompt: (i) =>
      `Age: ${i.age}\nStrength sessions per week: ${i.strength}\nCardio sessions per week: ${i.cardio}\n` +
      `Average sleep: ${i.sleep}\nCan get up from the floor without hands: ${i.floor}\n` +
      `Dead hang time: ${i.hang}\nMain goal: ${i.goal}\nAnything to be aware of: ${i.notes || "nothing given"}\n\n` +
      "Write a healthspan snapshot: a one-paragraph summary, the 3 focus areas that would matter most " +
      "for them (with why), 3 first steps for the next 14 days, and whether they should check with a " +
      "physician before increasing training (true/false) with a short reason.",
    schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        focus: {
          type: "array",
          items: {
            type: "object",
            properties: { area: { type: "string" }, why: { type: "string" } },
            required: ["area", "why"],
            additionalProperties: false,
          },
        },
        first_steps: { type: "array", items: { type: "string" } },
        see_physician: { type: "boolean" },
        physician_note: { type: "string" },
      },
      required: ["summary", "focus", "first_steps", "see_physician", "physician_note"],
      additionalProperties: false,
    },
    fields: ["age", "strength", "cardio", "sleep", "floor", "hang", "goal", "notes"],
    required: ["age", "goal"],
  },
};

export async function onRequestPost({ request, env }) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: "AI is not configured yet." }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const tool = TOOLS[body.tool];
  if (!tool) return json({ error: "Unknown tool." }, 400);
  if (body.website_hp) return json({ error: "Invalid request." }, 400);

  const email = String(body.email || "").trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Please enter a valid email." }, 400);

  const input = {};
  for (const f of tool.fields) input[f] = String(body[f] ?? "").slice(0, MAX_FIELD).trim();
  for (const f of tool.required) if (!input[f]) return json({ error: "Please fill in all required fields." }, 400);

  // Enkel rate limiting per IP (kun når KV er bundet)
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (env.LEADS) {
    const key = `rl:${ip}:${new Date().toISOString().slice(0, 13)}`;
    const used = Number((await env.LEADS.get(key)) || 0);
    if (used >= RATE_LIMIT) return json({ error: "Too many requests. Please try again later." }, 429);
    await env.LEADS.put(key, String(used + 1), { expirationTtl: 3600 });
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined });

  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: tool.system,
      messages: [{ role: "user", content: tool.prompt(input) }],
      output_config: { effort: "low", format: { type: "json_schema", schema: tool.schema } },
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return json({ error: "We're busy right now. Try again in a minute." }, 429);
    if (error instanceof Anthropic.APIError) {
      console.error("Claude API error", error.status, error.message);
      return json({ error: "The generator is unavailable right now." }, 502);
    }
    throw error;
  }

  if (response.stop_reason === "refusal") return json({ error: "We couldn't generate this. Please rephrase and try again." }, 422);
  if (response.stop_reason === "max_tokens") return json({ error: "The answer was too long. Please shorten your input." }, 422);

  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    return json({ error: "Something went wrong. Please try again." }, 502);
  }

  if (env.WEBHOOK_URL) {
    // Leadet sendes videre, men en feil her skal ikke stoppe svaret til brukeren
    await fetch(env.WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "lead_magnet", tool: body.tool, email, input, result, page: body.page, received_at: new Date().toISOString() }),
    }).catch((e) => console.error("Webhook failed", e));
  }

  return json({ ok: true, result });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}
