import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

import { loadEnvironment } from "./loadEnv";
import { formatSkillCatalog, loadSkills } from "./skills";

const loadedEnvFiles = loadEnvironment();
const openaiApiKey = process.env.OPENAI_API_KEY;
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

async function main() {
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
  const skills = await loadSkills();

  console.log(
    `Environment loaded from: ${
      loadedEnvFiles.length > 0 ? loadedEnvFiles.join(", ") : "no env files"
    }`,
  );
  console.log(`OpenAI client: ${openai ? "ready" : "not configured"}`);
  console.log(`Anthropic client: ${anthropic ? "ready" : "not configured"}`);
  console.log(`Loaded skills: ${skills.length}`);
  console.log(formatSkillCatalog(skills));
}

main().catch((error: unknown) => {
  console.error("Failed to start application.");
  console.error(error);
  process.exitCode = 1;
});
