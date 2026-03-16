import { Agent, Runner } from "@openai/agents";

import { loadEnvironment } from "./loadEnv";
import { formatSkillCatalog, loadSkillBody, loadSkills } from "./skills";

const loadedEnvFiles = loadEnvironment();
const openaiApiKey = process.env.OPENAI_API_KEY;
const openaiModel = process.env.OPENAI_MODEL ?? "gpt-5-mini";
const runner = new Runner({ tracingDisabled: true });

const sampleUserPrompt = (process.argv.slice(2).join(" ") || `
TypeScript で OpenAI SDK と Claude SDK を使う CLI サンプルを改善してください。
要件:
- .env.local を優先して API キーを読む
- README にセットアップ手順を追記する
- 実行コマンドも整理する
`).trim();

async function main() {
  if (!openaiApiKey) {
    console.warn("OPENAI_API_KEY is not set.");
  }

  const skills = await loadSkills();
  const manager = createManagerAgent(skills);

  console.log(
    `Environment loaded from: ${
      loadedEnvFiles.length > 0 ? loadedEnvFiles.join(", ") : "no env files"
    }`,
  );
  console.log(`OpenAI Agents client: ${openaiApiKey ? "ready" : "not configured"}`);
  console.log(`Model: ${openaiModel}`);
  console.log(`Loaded skills: ${skills.length}`);
  console.log(formatSkillCatalog(skills));
  console.log("\nSample user prompt:");
  console.log(sampleUserPrompt);
  console.log("\nRegistered skill tools:");
  for (const skill of skills) {
    console.log(`- ${skill.name}: ${skill.description}`);
  }

  if (!openaiApiKey) {
    console.log("\nOPENAI_API_KEY が未設定のため、Agent 実行はスキップしました。");
    return;
  }

  const result = await runner.run(manager, sampleUserPrompt);
  const usedSkillToolNames = extractUsedSkillToolNames(result.newItems);

  if (usedSkillToolNames.length === 0) {
    throw new Error(
      "skill tool が 1 つも使われませんでした。現在の設定では少なくとも 1 つの skill を使う想定です。",
    );
  }

  console.log("\nRun summary:");
  console.log(`- 使用された skill tools: ${usedSkillToolNames.join(", ")}`);
  console.log("- 期待される状態: ここに最終回答が表示されれば成功です");
  console.log("\nAgent response:");
  console.log(buildFinalDisplay(result.finalOutput ?? "", usedSkillToolNames));
}

function createManagerAgent(skills: Awaited<ReturnType<typeof loadSkills>>) {
  const skillTools = skills.map((skill) => createSkillAgent(skill).asTool({
    toolName: toToolName(skill.name),
    toolDescription: skill.description,
  }));

  return new Agent({
    name: "Agent Skills Manager",
    model: openaiModel,
    instructions: [
      "あなたは Agent Skills を使って作業するコーディングエージェントです。",
      "利用可能な skill tool の description を見て、依頼に関連するものを必ず少なくとも1つ使ってください。",
      "一般知識だけで答えられそうでも、今回の実装では必ず skill tool を使ってから回答してください。",
      "使っていない skill を使ったとは書かないでください。",
      "最終回答では、skill 使用履歴を自称しないでください。skill 名の表示はホスト側が行います。",
      "回答は日本語で簡潔にしてください。",
    ].join("\n"),
    tools: skillTools,
    modelSettings: {
      toolChoice: "required",
      parallelToolCalls: true,
    },
  });
}

function createSkillAgent(skill: Awaited<ReturnType<typeof loadSkills>>[number]) {
  return new Agent({
    name: `${skill.name} specialist`,
    model: openaiModel,
    instructions: async () => {
      const skillBody = await loadSkillBody(skill.path);

      return [
        `あなたは "${skill.name}" 専門のサブエージェントです。`,
        `Skill description: ${skill.description}`,
        "以下の skill 内容に従って、依頼に必要な部分だけを実務的に返してください。",
        "skill に書かれていないことは断定しないでください。",
        "回答は日本語で簡潔にしてください。",
        "",
        skillBody,
      ].join("\n");
    },
  });
}

function toToolName(skillName: string): string {
  const normalized = skillName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "skill_tool";
}

function extractUsedSkillToolNames(
  items: Array<{ type: string; toolName?: string; name?: string }>,
): string[] {
  const used = new Set<string>();

  for (const item of items) {
    if (item.type !== "tool_call_item" && item.type !== "tool_call_output_item") {
      continue;
    }

    const toolName = item.toolName ?? item.name;
    if (!toolName) {
      continue;
    }

    used.add(toolName);
  }

  return [...used.values()].sort();
}

function buildFinalDisplay(finalOutput: string, usedSkillToolNames: string[]): string {
  return [
    `使用した skill tools: ${usedSkillToolNames.join(", ")}`,
    "",
    finalOutput,
  ].join("\n");
}

main().catch((error: unknown) => {
  console.error("Failed to start application.");
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
