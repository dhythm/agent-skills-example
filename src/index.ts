import "dotenv/config";

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

const openaiApiKey = process.env.OPENAI_API_KEY;
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

if (!openaiApiKey) {
  console.warn("OPENAI_API_KEY is not set.");
}

if (!anthropicApiKey) {
  console.warn("ANTHROPIC_API_KEY is not set.");
}

const openai = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;
const anthropic = anthropicApiKey
  ? new Anthropic({ apiKey: anthropicApiKey })
  : null;

console.log("Environment loaded.");
console.log(`OpenAI client: ${openai ? "ready" : "not configured"}`);
console.log(`Anthropic client: ${anthropic ? "ready" : "not configured"}`);
