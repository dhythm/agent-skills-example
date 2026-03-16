import fs from "node:fs/promises";
import path from "node:path";

import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta";

import { loadEnvironment } from "./loadEnv";
import { formatSkillCatalog, loadSkills } from "./skills";

const loadedEnvFiles = loadEnvironment();
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
const anthropicModel = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";
const sampleUserPrompt = (process.argv.slice(2).join(" ") || `
このプロジェクトが Claude Skills API を使って local skills を同期し、
PowerPoint を生成する流れを、非エンジニアにも伝わるように
わかりやすいスライドにまとめてください。
`).trim();

const codeExecutionBeta = "code-execution-2025-08-25" as const;
const skillsBeta = "skills-2025-10-02" as const;
const filesApiBeta = "files-api-2025-04-14" as const;
const outputDirPath = path.resolve(process.cwd(), "output");

async function main() {
  if (!anthropicApiKey) {
    console.warn("ANTHROPIC_API_KEY is not set.");
  }

  const allSkills = await loadSkills();
  const pptxSkill = allSkills.find(
    (skill) => skill.scope === "project" && skill.name === "pptx",
  );

  console.log(
    `Environment loaded from: ${
      loadedEnvFiles.length > 0 ? loadedEnvFiles.join(", ") : "no env files"
    }`,
  );
  console.log(`Anthropic client: ${anthropicApiKey ? "ready" : "not configured"}`);
  console.log(`Model: ${anthropicModel}`);
  console.log(`Loaded skills: ${allSkills.length}`);
  console.log(formatSkillCatalog(allSkills));
  console.log("\nSample user prompt:");
  console.log(sampleUserPrompt);

  if (!anthropicApiKey) {
    console.log("\nANTHROPIC_API_KEY が未設定のため、Claude Skills 実行はスキップしました。");
    return;
  }

  if (!pptxSkill) {
    throw new Error("project scope の `pptx` skill が見つかりませんでした。");
  }

  const client = new Anthropic({ apiKey: anthropicApiKey });
  console.log("\nUsing Claude built-in skill:");
  console.log("- pptx");

  const response = await runUntilPptxGenerated(client, sampleUserPrompt);

  const downloadedFiles = await downloadGeneratedFiles(client, response);
  const responseText = extractTextResponse(response);

  console.log("\nRun summary:");
  console.log("- Claude container loaded skills: pptx");
  console.log(`- Container skill count: ${response.container?.skills?.length ?? 0}`);
  if (downloadedFiles.length === 0) {
    console.log(`- stop_reason: ${response.stop_reason}`);
    console.log(`- content block types: ${response.content.map((block) => block.type).join(", ")}`);
    throw new Error(
      "Claude の応答に PowerPoint ファイルが含まれていませんでした。text のみ返している可能性があります。",
    );
  }
  console.log(`- Downloaded files: ${downloadedFiles.join(", ")}`);
  console.log("- 期待される状態: output 配下に .pptx が生成され、ここに要約が表示されれば成功です");
  console.log("\nClaude summary:");
  console.log(responseText || "(text summary not returned)");
}

async function downloadGeneratedFiles(
  client: Anthropic,
  response: BetaMessage,
): Promise<string[]> {
  await fs.mkdir(outputDirPath, { recursive: true });
  const fileIds = extractFileIds(response);

  const downloadedPaths: string[] = [];

  for (const fileId of fileIds) {
    const metadata = await client.beta.files.retrieveMetadata(fileId, {
      betas: [filesApiBeta],
    });
    const download = await client.beta.files.download(fileId, {
      betas: [filesApiBeta],
    });
    const arrayBuffer = await download.arrayBuffer();
    const filePath = path.join(outputDirPath, metadata.filename);

    await fs.writeFile(filePath, Buffer.from(arrayBuffer));
    downloadedPaths.push(filePath);
  }

  return downloadedPaths;
}

async function runUntilPptxGenerated(
  client: Anthropic,
  userPrompt: string,
): Promise<BetaMessage> {
  let container: { id?: string | null; skills?: Array<{ type: "anthropic"; skill_id: "pptx"; version: "latest" }> } | string = {
    skills: [
      {
        type: "anthropic",
        skill_id: "pptx",
        version: "latest",
      },
    ],
  };

  let response = await client.beta.messages.create({
    model: anthropicModel,
    max_tokens: 4096,
    stream: false,
    betas: [codeExecutionBeta, skillsBeta, filesApiBeta],
    tool_choice: {
      type: "any",
      disable_parallel_tool_use: true,
    },
    tools: [
      {
        name: "code_execution",
        type: "code_execution_20250825",
      },
    ],
    container,
    system: [
      {
        type: "text",
        text: [
          "You must use the pptx skill and code execution to generate a real .pptx file.",
          "Do not stop at an outline or draft.",
          "Your task is incomplete unless the final response includes at least one generated PowerPoint file.",
        ].join(" "),
      },
    ],
    messages: [
      {
        role: "user",
        content: buildSlidePrompt(userPrompt),
      },
    ],
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const fileIds = extractFileIds(response);
    if (fileIds.length > 0) {
      return response;
    }

    if (response.stop_reason !== "max_tokens" || !response.container?.id) {
      return response;
    }

    container = response.container.id;
    response = await client.beta.messages.create({
      model: anthropicModel,
      max_tokens: 4096,
      stream: false,
      betas: [codeExecutionBeta, skillsBeta, filesApiBeta],
      tool_choice: {
        type: "any",
        disable_parallel_tool_use: true,
      },
      tools: [
        {
          name: "code_execution",
          type: "code_execution_20250825",
        },
      ],
      container,
      system: [
        {
          type: "text",
          text: [
            "Continue from the current container state.",
            "Finish the PowerPoint and include the generated .pptx file in the final response.",
            "Do not restart from scratch.",
          ].join(" "),
        },
      ],
      messages: [
        {
          role: "user",
          content:
            "続けてください。必ず `.pptx` ファイルを生成し、最終レスポンスに添付してください。",
        },
      ],
    });
  }

  return response;
}

function extractTextResponse(response: BetaMessage) {
  return response.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function buildSlidePrompt(userPrompt: string): string {
  return [
    "以下の依頼に対して、pptx skill を使って .pptx ファイルを作成してください。",
    "最終的な成果物は PowerPoint ファイルそのものです。",
    "テキストだけで終わらず、必ず .pptx を生成して最終レスポンスに含めてください。",
    "ファイル名は `claude-skills-deck.pptx` にしてください。",
    "PowerPoint ファイルを生成できない場合は、その理由を短く説明してください。",
    "説明文は短くて構いませんが、ファイル生成を優先してください。",
    "非エンジニアにも伝わる、見やすく実務的なスライドにしてください。",
    "今回の題材は営業資料ではありません。このリポジトリの仕組み説明資料です。",
    "営業戦略、一般的な会社紹介、新製品提案のような無関係な内容は作らないでください。",
    "スライド内容は必ず以下の要素を含めてください。",
    "- Claude Skills API を使うこと",
    "- local skills を project 内に置いていること",
    "- built-in `pptx` skill を container.skills で使うこと",
    "- code execution により .pptx を生成すること",
    "- 生成された .pptx を output/ に保存すること",
    "対象読者は非エンジニアなので、専門用語は短く説明してください。",
    "スライドは 5 から 8 枚程度にしてください。",
    "",
    "依頼:",
    userPrompt,
  ].join("\n");
}

function extractFileIds(
  response: BetaMessage,
): string[] {
  const fileIds = new Set<string>();

  for (const block of response.content as unknown as Array<Record<string, unknown>>) {
    if (block.type === "container_upload" && typeof block.file_id === "string") {
      fileIds.add(block.file_id);
      continue;
    }

    if (block.type !== "bash_code_execution_tool_result") {
      continue;
    }

    const content = block.content as Record<string, unknown> | undefined;
    if (!content || content.type !== "bash_code_execution_result") {
      continue;
    }

    const outputs = Array.isArray(content.content) ? content.content : [];
    for (const output of outputs) {
      const item = output as Record<string, unknown>;
      if (typeof item.file_id === "string") {
        fileIds.add(item.file_id);
      }
    }
  }

  return [...fileIds.values()];
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
