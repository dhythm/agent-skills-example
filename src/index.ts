import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import Anthropic, { toFile } from "@anthropic-ai/sdk";
import type { BetaMessage, BetaSkillParams } from "@anthropic-ai/sdk/resources/beta";
import OpenAI from "openai";
import type { Response, Responses } from "openai/resources/responses/responses";

import { loadEnvironment } from "./loadEnv";
import { formatSkillCatalog, loadSkills, type SkillDefinition } from "./skills";

const execFile = promisify(execFileCallback);

type Provider = "anthropic" | "openai";
type SkillSource = "builtin" | "local";

type AppOptions = {
  provider: Provider;
  prompt: string;
  skillSource: SkillSource;
};

type ManifestEntry = {
  contentHash: string;
  skillId: string;
  updatedAt: string;
  version: string;
};

type ManifestData = {
  customSkills?: Record<string, ManifestEntry>;
};

const loadedEnvFiles = loadEnvironment();
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
const anthropicModel = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const openaiApiKey = process.env.OPENAI_API_KEY;
const openaiModel = process.env.OPENAI_MODEL ?? "gpt-5.4";
const outputDirPath = path.resolve(process.cwd(), "output");
const manifestPath = path.resolve(process.cwd(), ".claude-skills-manifest.json");
const openaiSkillDirPath = path.resolve(
  process.cwd(),
  process.env.OPENAI_SLIDES_SKILL_PATH ?? ".agents/skills/slides",
);
const defaultPrompt = `
このプロジェクトが Agent Skills を使って local skills を活用し、
PowerPoint を生成する流れを、非エンジニアにも伝わるように
わかりやすいスライドにまとめてください。
`.trim();

const codeExecutionBeta = "code-execution-2025-08-25" as const;
const skillsBeta = "skills-2025-10-02" as const;
const filesApiBeta = "files-api-2025-04-14" as const;

async function main() {
  const options = parseAppOptions(process.argv.slice(2));

  if (options.provider === "anthropic" && !anthropicApiKey) {
    console.warn("ANTHROPIC_API_KEY is not set.");
  }
  if (options.provider === "openai" && !openaiApiKey) {
    console.warn("OPENAI_API_KEY is not set.");
  }

  const allSkills = await loadSkills();
  const pptxSkill = allSkills.find((skill) => skill.scope === "project" && skill.name === "pptx");
  const slidesSkill = allSkills.find((skill) => skill.scope === "project" && skill.name === "slides");

  console.log(
    `Environment loaded from: ${
      loadedEnvFiles.length > 0 ? loadedEnvFiles.join(", ") : "no env files"
    }`,
  );
  console.log(`Provider: ${options.provider}`);
  console.log(
    `Anthropic client: ${anthropicApiKey ? "ready" : "not configured"}`,
  );
  console.log(`OpenAI client: ${openaiApiKey ? "ready" : "not configured"}`);
  console.log(`Model: ${options.provider === "anthropic" ? anthropicModel : openaiModel}`);
  console.log(`Skill source: ${options.skillSource}`);
  console.log(`Loaded skills: ${allSkills.length}`);
  console.log(formatSkillCatalog(allSkills));
  console.log("\nSample user prompt:");
  console.log(options.prompt);

  if (options.provider === "anthropic") {
    await runAnthropicFlow({
      prompt: options.prompt,
      pptxSkill,
      skillSource: options.skillSource,
    });
    return;
  }

  await runOpenAiFlow({
    prompt: options.prompt,
    slidesSkill,
    skillSource: options.skillSource,
  });
}

async function runAnthropicFlow({
  prompt,
  pptxSkill,
  skillSource,
}: {
  prompt: string;
  pptxSkill?: SkillDefinition;
  skillSource: SkillSource;
}) {
  if (!anthropicApiKey) {
    console.log("\nANTHROPIC_API_KEY が未設定のため、Claude 実行はスキップしました。");
    return;
  }

  if (!pptxSkill) {
    throw new Error("project scope の `pptx` skill が見つかりませんでした。");
  }

  const client = new Anthropic({ apiKey: anthropicApiKey });
  const skillConfig = await resolveSkillConfig(client, pptxSkill, skillSource);

  console.log(`\nUsing Claude ${skillSource === "builtin" ? "built-in" : "local custom"} skill:`);
  console.log(`- ${pptxSkill.name}`);
  if (skillSource === "local") {
    console.log("- local skill directory is uploaded as a custom skill version");
  }

  const response = await runUntilPptxGenerated(client, prompt, skillConfig);
  const downloadedFiles = await downloadGeneratedFiles(client, response);
  const responseText = extractTextResponse(response);

  console.log("\nRun summary:");
  console.log(`- Requested provider: anthropic`);
  console.log(`- Requested skill source: ${skillSource}`);
  console.log(`- Requested Claude skill: ${skillConfig.skill.skill_id}@${skillConfig.skill.version ?? "latest"}`);
  if (skillConfig.syncedVersion) {
    console.log(`- Synced local custom skill version: ${skillConfig.syncedVersion}`);
  }
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

async function runOpenAiFlow({
  prompt,
  slidesSkill,
  skillSource,
}: {
  prompt: string;
  slidesSkill?: SkillDefinition;
  skillSource: SkillSource;
}) {
  if (!openaiApiKey) {
    console.log("\nOPENAI_API_KEY が未設定のため、OpenAI 実行はスキップしました。");
    return;
  }

  if (skillSource !== "local") {
    throw new Error("OpenAI では現在 `--skill-source=local` のみサポートしています。");
  }

  if (!slidesSkill) {
    throw new Error(
      `project scope の \`slides\` skill が見つかりませんでした。期待パス: ${openaiSkillDirPath}`,
    );
  }

  const client = new OpenAI({ apiKey: openaiApiKey });
  const inlineSkill = await buildOpenAiInlineSkill(slidesSkill);

  console.log("\nUsing OpenAI local skill:");
  console.log(`- ${slidesSkill.name}`);
  console.log(`- ${slidesSkill.path}`);
  console.log("- local skill directory is attached as an inline skill bundle");

  const response = await runUntilOpenAiDeckGenerated(client, prompt, inlineSkill);
  const downloadedFiles = await downloadOpenAiGeneratedFiles(client, response);
  const shellOutputs = extractOpenAiShellOutputs(response);

  console.log("\nRun summary:");
  console.log("- Requested provider: openai");
  console.log(`- Requested skill source: ${skillSource}`);
  console.log(`- Model: ${openaiModel}`);
  if (downloadedFiles.length === 0) {
    console.log(`- response status: ${response.status}`);
    console.log(`- output item types: ${response.output.map((item) => item.type).join(", ")}`);
    if (shellOutputs) {
      console.log("- shell output:");
      console.log(shellOutputs);
    }
    throw new Error(
      "OpenAI の応答から PowerPoint ファイルを取得できませんでした。shell 実行結果を確認してください。",
    );
  }
  console.log(`- Downloaded files: ${downloadedFiles.join(", ")}`);
  console.log("- 期待される状態: output 配下に .pptx と .js が生成されれば成功です");
  console.log("\nOpenAI summary:");
  console.log(response.output_text?.trim() || "(text summary not returned)");
}

async function resolveSkillConfig(
  client: Anthropic,
  pptxSkill: SkillDefinition,
  skillSource: SkillSource,
): Promise<{ skill: BetaSkillParams; syncedVersion?: string }> {
  if (skillSource === "builtin") {
    return {
      skill: {
        type: "anthropic",
        skill_id: "pptx",
        version: "latest",
      },
    };
  }

  const synced = await syncLocalCustomSkill(client, pptxSkill);
  return {
    skill: {
      type: "custom",
      skill_id: synced.skillId,
      version: synced.version,
    },
    syncedVersion: synced.version,
  };
}

async function syncLocalCustomSkill(
  client: Anthropic,
  skill: SkillDefinition,
): Promise<ManifestEntry> {
  const manifest = await readManifest();
  const files = await buildSkillUploadFiles(skill);
  const contentHash = await createSkillHash(files);
  const current = manifest.customSkills?.[skill.name];

  if (current && current.contentHash === contentHash) {
    return current;
  }

  const nextEntry = current
    ? await createCustomSkillVersion(client, skill.name, current.skillId, files, contentHash)
    : await createCustomSkill(client, skill.name, files, contentHash);

  const nextManifest: ManifestData = {
    ...manifest,
    customSkills: {
      ...(manifest.customSkills ?? {}),
      [skill.name]: nextEntry,
    },
  };
  await writeManifest(nextManifest);

  return nextEntry;
}

async function createCustomSkill(
  client: Anthropic,
  displayTitle: string,
  files: File[],
  contentHash: string,
): Promise<ManifestEntry> {
  const created = await client.beta.skills.create({
    display_title: displayTitle,
    files,
  });

  if (!created.latest_version) {
    throw new Error("custom skill の初回作成に成功しましたが、version を取得できませんでした。");
  }

  return {
    contentHash,
    skillId: created.id,
    updatedAt: new Date().toISOString(),
    version: created.latest_version,
  };
}

async function createCustomSkillVersion(
  client: Anthropic,
  displayTitle: string,
  skillId: string,
  files: File[],
  contentHash: string,
): Promise<ManifestEntry> {
  try {
    const created = await client.beta.skills.versions.create(skillId, {
      files,
    });

    return {
      contentHash,
      skillId,
      updatedAt: new Date().toISOString(),
      version: created.version,
    };
  } catch (error) {
    const apiError = error as { status?: number };
    if (apiError.status !== 404) {
      throw error;
    }

    return createCustomSkill(client, displayTitle, files, contentHash);
  }
}

async function buildSkillUploadFiles(skill: SkillDefinition): Promise<File[]> {
  const skillDir = path.dirname(skill.path);
  const topLevelDir = path.basename(skillDir);
  const filePaths = await listFilesRecursive(skillDir);
  const seenNames = new Set<string>();
  const files: File[] = [];

  for (const filePath of filePaths) {
    const relativePath = path.relative(skillDir, filePath).split(path.sep).join("/");
    const uploadName = `${topLevelDir}/${relativePath}`;

    if (seenNames.has(uploadName)) {
      throw new Error(`custom skill upload に重複パスがあります: ${uploadName}`);
    }

    const file = await toFile(await fs.readFile(filePath), uploadName);
    seenNames.add(uploadName);
    files.push(file);
  }

  return files.sort((a, b) => a.name.localeCompare(b.name));
}

async function listFilesRecursive(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const filePaths: string[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      filePaths.push(...(await listFilesRecursive(entryPath)));
      continue;
    }
    if (entry.isFile()) {
      filePaths.push(entryPath);
    }
  }

  return filePaths;
}

async function createSkillHash(files: File[]): Promise<string> {
  const hash = createHash("sha256");

  for (const file of files) {
    hash.update(file.name);
    hash.update(Buffer.from(await file.arrayBuffer()));
  }

  return hash.digest("hex");
}

async function readManifest(): Promise<ManifestData> {
  try {
    const content = await fs.readFile(manifestPath, "utf8");
    return JSON.parse(content) as ManifestData;
  } catch (error) {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

async function writeManifest(manifest: ManifestData): Promise<void> {
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
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
  skillConfig: { skill: BetaSkillParams },
): Promise<BetaMessage> {
  let container:
    | { id?: string | null; skills?: BetaSkillParams[] }
    | string = {
    skills: [skillConfig.skill],
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
          "You must use the configured pptx skill and code execution to generate a real .pptx file.",
          "Do not stop at an outline or draft.",
          "Your task is incomplete unless the final response includes at least one generated PowerPoint file.",
        ].join(" "),
      },
    ],
    messages: [
      {
        role: "user",
        content: buildSlidePrompt(userPrompt, skillConfig.skill.type),
      },
    ],
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (extractFileIds(response).length > 0) {
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

async function buildOpenAiInlineSkill(skill: SkillDefinition): Promise<Responses.InlineSkill> {
  const skillDir = path.dirname(skill.path);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openai-skill-"));
  const zipPath = path.join(tempDir, `${skill.name}.zip`);

  try {
    await execFile("zip", ["-rq", zipPath, "."], { cwd: skillDir });
    const bundle = await fs.readFile(zipPath);

    return {
      type: "inline",
      name: skill.name,
      description: skill.description,
      source: {
        type: "base64",
        media_type: "application/zip",
        data: bundle.toString("base64"),
      },
    };
  } catch (error) {
    throw new Error(
      `OpenAI 用スキルの zip 化に失敗しました。zip コマンドが利用可能か確認してください。${error instanceof Error ? ` (${error.message})` : ""}`,
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function runUntilOpenAiDeckGenerated(
  client: OpenAI,
  userPrompt: string,
  skill: Responses.InlineSkill,
): Promise<Response> {
  return client.responses.create({
    model: openaiModel,
    max_output_tokens: 4096,
    input: [
      {
        role: "system",
        content: [
          "You must use the configured slides skill and the shell tool to generate a real PowerPoint file.",
          "Do not stop at an outline or draft.",
          "Your task is incomplete unless the final artifacts include at least one .pptx file and the authoring .js file.",
          "Save final artifacts under /mnt/data so they can be downloaded after the run.",
        ].join(" "),
      },
      {
        role: "user",
        content: buildOpenAiSlidePrompt(userPrompt),
      },
    ],
    tools: [
      {
        type: "shell",
        environment: {
          type: "container_auto",
          skills: [skill],
        },
      },
    ],
  });
}

async function downloadOpenAiGeneratedFiles(
  client: OpenAI,
  response: Response,
): Promise<string[]> {
  await fs.mkdir(outputDirPath, { recursive: true });
  const containerIds = extractOpenAiContainerIds(response);
  const downloadedPaths: string[] = [];

  for (const containerId of containerIds) {
    const files = await client.containers.files.list(containerId, { order: "asc" });

    for await (const file of files) {
      const normalizedPath = file.path.toLowerCase();
      const shouldDownload =
        normalizedPath.endsWith(".pptx") ||
        normalizedPath.endsWith(".js") ||
        normalizedPath.endsWith(".png");

      if (!shouldDownload) {
        continue;
      }

      const fileName = path.basename(file.path);
      const localPath = path.join(outputDirPath, fileName);
      const content = await client.containers.files.content.retrieve(file.id, {
        container_id: containerId,
      });
      const arrayBuffer = await content.arrayBuffer();

      await fs.writeFile(localPath, Buffer.from(arrayBuffer));
      downloadedPaths.push(localPath);
    }
  }

  return downloadedPaths;
}

function extractOpenAiContainerIds(response: Response): string[] {
  const containerIds = new Set<string>();

  for (const item of response.output) {
    if (item.type !== "shell_call") {
      continue;
    }

    if (item.environment?.type === "container_reference") {
      containerIds.add(item.environment.container_id);
    }
  }

  return [...containerIds.values()];
}

function extractOpenAiShellOutputs(response: Response): string {
  return response.output
    .filter(
      (item): item is Responses.ResponseFunctionShellToolCallOutput =>
        item.type === "shell_call_output",
    )
    .flatMap((item) =>
      item.output.map((chunk, index) =>
        [
          `chunk ${index + 1}:`,
          chunk.stdout.trim(),
          chunk.stderr.trim() ? `stderr:\n${chunk.stderr.trim()}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    )
    .join("\n\n")
    .trim();
}

function extractTextResponse(response: BetaMessage) {
  return response.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function buildSlidePrompt(userPrompt: string, skillType: BetaSkillParams["type"]): string {
  const skillLabel = skillType === "custom" ? "project 配下の local custom `pptx` skill" : "built-in `pptx` skill";

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
    `- ${skillLabel} を使うこと`,
    "- code execution により .pptx を生成すること",
    "- 生成された .pptx を output/ に保存すること",
    "対象読者は非エンジニアなので、専門用語は短く説明してください。",
    "スライドは 5 から 8 枚程度にしてください。",
    "",
    "依頼:",
    userPrompt,
  ].join("\n");
}

function buildOpenAiSlidePrompt(userPrompt: string): string {
  return [
    "以下の依頼に対して、slides skill と shell を使って .pptx ファイルを作成してください。",
    "最終的な成果物は PowerPoint ファイルそのものです。",
    "テキストだけで終わらず、必ず .pptx を生成してください。",
    "生成した PowerPoint の authoring source となる .js も必ず保存してください。",
    "最終成果物は `/mnt/data/openai-skills-deck.pptx` と `/mnt/data/openai-skills-deck.js` に保存してください。",
    "可能なら確認用のレンダリング画像も `/mnt/data/rendered/` に出力してください。",
    "非エンジニアにも伝わる、見やすく実務的なスライドにしてください。",
    "今回の題材は営業資料ではありません。このリポジトリの仕組み説明資料です。",
    "OpenAI と Claude の両対応を前提にしたリポジトリであることを明確にしてください。",
    "スライド内容は必ず以下の要素を含めてください。",
    "- Claude では Skills API を使うこと",
    "- OpenAI では shell tool に skill を与えて実行すること",
    "- local skills を project 内に置いていること",
    "- provider を切り替えて実行できること",
    "- 生成された .pptx を output/ に保存すること",
    "スライドは 5 から 8 枚程度にしてください。",
    "",
    "依頼:",
    userPrompt,
  ].join("\n");
}

function extractFileIds(response: BetaMessage): string[] {
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

function parseAppOptions(argv: string[]): AppOptions {
  const promptTokens: string[] = [];
  let provider = normalizeProvider(process.env.MODEL_PROVIDER);
  let skillSource = normalizeSkillSource(process.env.CLAUDE_PPTX_SKILL_SOURCE);

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--provider") {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        throw new Error("`--provider` には `anthropic` または `openai` を指定してください。");
      }
      provider = normalizeProvider(nextValue);
      index += 1;
      continue;
    }

    if (value.startsWith("--provider=")) {
      const [, providerValue = ""] = value.split("=", 2);
      provider = normalizeProvider(providerValue);
      continue;
    }

    if (value === "--skill-source" || value === "--mode") {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        throw new Error("`--skill-source` には `builtin` または `local` を指定してください。");
      }
      skillSource = normalizeSkillSource(nextValue);
      index += 1;
      continue;
    }

    if (value.startsWith("--skill-source=") || value.startsWith("--mode=")) {
      const [, sourceValue = ""] = value.split("=", 2);
      skillSource = normalizeSkillSource(sourceValue);
      continue;
    }

    promptTokens.push(value);
  }

  return {
    provider,
    prompt: (promptTokens.join(" ") || defaultPrompt).trim(),
    skillSource: provider === "openai" ? "local" : skillSource,
  };
}

function normalizeProvider(value?: string): Provider {
  if (!value || value.trim() === "") {
    return "anthropic";
  }

  if (value === "anthropic" || value === "openai") {
    return value;
  }

  throw new Error("MODEL_PROVIDER には `anthropic` または `openai` を指定してください。");
}

function normalizeSkillSource(value?: string): SkillSource {
  if (!value || value.trim() === "") {
    return "builtin";
  }

  if (value === "builtin" || value === "local") {
    return value;
  }

  throw new Error("CLAUDE_PPTX_SKILL_SOURCE には `builtin` または `local` を指定してください。");
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
