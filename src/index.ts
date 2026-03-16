import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import Anthropic from "@anthropic-ai/sdk";
import { toFile } from "@anthropic-ai/sdk/uploads";
import PptxGenJS from "pptxgenjs";
import { z } from "zod";

import { loadEnvironment } from "./loadEnv";
import { formatSkillCatalog, loadSkills, type SkillDefinition } from "./skills";

const loadedEnvFiles = loadEnvironment();
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
const anthropicModel = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";
const sampleUserPrompt = (process.argv.slice(2).join(" ") || `
このプロジェクトが Claude Skills API を使って local skills を同期し、
PowerPoint を生成する流れを、非エンジニアにも伝わるように
わかりやすいスライドにまとめてください。
`).trim();

const skillsBeta = "skills-2025-10-02" as const;
const codeExecutionBeta = "code-execution-2025-08-25" as const;
const manifestPath = path.resolve(process.cwd(), ".claude-skills-manifest.json");
const outputDirPath = path.resolve(process.cwd(), "output");
const outputPptxPath = path.join(outputDirPath, "claude-skills-deck.pptx");

const slideDeckSchema = z.object({
  deckTitle: z.string().min(1),
  subtitle: z.string().optional().default(""),
  slides: z
    .array(
      z.object({
        title: z.string().min(1),
        bullets: z.array(z.string().min(1)).min(1).max(6),
      }),
    )
    .min(3)
    .max(8),
});

type SlideDeck = z.infer<typeof slideDeckSchema>;

type ManifestEntry = {
  hash: string;
  skillId: string;
  version: string;
};

type Manifest = Record<string, ManifestEntry>;

async function main() {
  if (!anthropicApiKey) {
    console.warn("ANTHROPIC_API_KEY is not set.");
  }

  const allSkills = await loadSkills();
  const projectSkills = allSkills.filter((skill) => skill.scope === "project");

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

  if (projectSkills.length === 0) {
    throw new Error("project scope の skill が見つかりませんでした。");
  }

  const client = new Anthropic({ apiKey: anthropicApiKey });
  const syncedSkills = await syncProjectSkills(client, projectSkills);

  console.log("\nSynced Claude custom skills:");
  for (const skill of syncedSkills) {
    console.log(`- ${skill.name}: ${skill.skillId}@${skill.version}`);
  }

  const response = await client.beta.messages.create({
    model: anthropicModel,
    max_tokens: 1200,
    betas: [codeExecutionBeta, skillsBeta],
    tools: [
      {
        name: "code_execution",
        type: "code_execution_20250825",
      },
    ],
    container: {
      skills: syncedSkills.map((skill) => ({
        type: "custom",
        skill_id: skill.skillId,
        version: skill.version,
      })),
    },
    messages: [
      {
        role: "user",
        content: buildSlidePrompt(sampleUserPrompt),
      },
    ],
  });

  const responseText = extractTextResponse(response);
  const slideDeck = parseSlideDeck(responseText);
  await writePowerPoint(slideDeck);

  console.log("\nRun summary:");
  console.log(
    `- Claude container loaded skills: ${syncedSkills
      .map((skill) => skill.name)
      .join(", ")}`,
  );
  console.log(`- Container skill count: ${response.container?.skills?.length ?? 0}`);
  console.log(`- PowerPoint output: ${outputPptxPath}`);
  console.log("- 期待される状態: PowerPoint ファイルが生成され、ここに要約が表示されれば成功です");
  console.log("\nSlide summary:");
  console.log(`- deckTitle: ${slideDeck.deckTitle}`);
  console.log(`- slides: ${slideDeck.slides.length}`);
  for (const slide of slideDeck.slides) {
    console.log(`- ${slide.title}`);
  }
}

async function syncProjectSkills(client: Anthropic, skills: SkillDefinition[]) {
  const manifest = await readManifest();
  const remoteSkills = await listCustomSkills(client);
  const updatedManifest: Manifest = {};
  const synced: Array<{ name: string; skillId: string; version: string }> = [];

  for (const skill of skills) {
    const hash = await hashSkillDirectory(skill.path);
    const manifestEntry = manifest[skill.name];

    if (manifestEntry?.hash === hash) {
      synced.push({
        name: skill.name,
        skillId: manifestEntry.skillId,
        version: manifestEntry.version,
      });
      continue;
    }

    const uploadFiles = await buildSkillUploadFiles(skill.path);
    const displayTitle = buildDisplayTitle(skill.name);
    const remoteSkill = remoteSkills.get(displayTitle);

    if (!remoteSkill) {
      const created = await client.beta.skills.create({
        display_title: displayTitle,
        files: uploadFiles,
        betas: [skillsBeta],
      });

      const version = created.latest_version ?? "latest";
      updatedManifest[skill.name] = {
        hash,
        skillId: created.id,
        version,
      };
      synced.push({ name: skill.name, skillId: created.id, version });
      continue;
    }

    const createdVersion = await client.beta.skills.versions.create(remoteSkill.id, {
      files: uploadFiles,
      betas: [skillsBeta],
    });

    updatedManifest[skill.name] = {
      hash,
      skillId: remoteSkill.id,
      version: createdVersion.version,
    };
    synced.push({
      name: skill.name,
      skillId: remoteSkill.id,
      version: createdVersion.version,
    });
  }

  await writeManifest(updatedManifest);

  return synced;
}

async function listCustomSkills(client: Anthropic) {
  const map = new Map<string, { id: string; latestVersion: string | null }>();

  for await (const skill of client.beta.skills.list({
    source: "custom",
    betas: [skillsBeta],
  })) {
    if (!skill.display_title) {
      continue;
    }

    map.set(skill.display_title, {
      id: skill.id,
      latestVersion: skill.latest_version,
    });
  }

  return map;
}

async function buildSkillUploadFiles(skillPath: string) {
  const skillDir = path.dirname(skillPath);
  const rootDirName = path.basename(skillDir);
  const filePaths = await collectFiles(skillDir);

  return Promise.all(
    filePaths.map(async (filePath) => {
      const relativePath = path.relative(skillDir, filePath);
      const file = await fs.readFile(filePath);

      return toFile(file, path.posix.join(rootDirName, toPosixPath(relativePath)));
    }),
  );
}

async function collectFiles(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }

    files.push(fullPath);
  }

  return files.sort();
}

async function hashSkillDirectory(skillPath: string): Promise<string> {
  const hash = createHash("sha256");
  const skillDir = path.dirname(skillPath);
  const filePaths = await collectFiles(skillDir);

  for (const filePath of filePaths) {
    hash.update(path.relative(skillDir, filePath));
    hash.update(await fs.readFile(filePath));
  }

  return hash.digest("hex");
}

async function readManifest(): Promise<Manifest> {
  try {
    return JSON.parse(await fs.readFile(manifestPath, "utf8")) as Manifest;
  } catch (error) {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

async function writeManifest(manifest: Manifest): Promise<void> {
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

function buildDisplayTitle(skillName: string): string {
  return `agent-skills-example/${skillName}`;
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join(path.posix.sep);
}

function extractTextResponse(response: Awaited<ReturnType<Anthropic["beta"]["messages"]["create"]>>) {
  if (!("content" in response)) {
    return "";
  }

  return response.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function buildSlidePrompt(userPrompt: string): string {
  return [
    "以下の依頼に対して、日本語の PowerPoint スライド構成を作成してください。",
    "回答は JSON のみで返してください。前置きや説明文は不要です。",
    "形式:",
    JSON.stringify(
      {
        deckTitle: "スライド全体タイトル",
        subtitle: "任意のサブタイトル",
        slides: [
          {
            title: "スライドタイトル",
            bullets: ["箇条書き1", "箇条書き2"],
          },
        ],
      },
      null,
      2,
    ),
    "ルール:",
    "- slides は 3 から 8 枚",
    "- 各 slide の bullets は 1 から 6 個",
    "- 箇条書きは短く、PowerPoint にそのまま載せられる文にする",
    "- 既存プロジェクト文脈に合わない仮定は避ける",
    "- 同期された skill の意図を反映する",
    "",
    "依頼:",
    userPrompt,
  ].join("\n");
}

function parseSlideDeck(responseText: string): SlideDeck {
  const jsonText = extractJsonObject(responseText);
  const parsed = JSON.parse(jsonText) as unknown;

  return slideDeckSchema.parse(parsed);
}

function extractJsonObject(responseText: string): string {
  const startIndex = responseText.indexOf("{");
  const endIndex = responseText.lastIndexOf("}");

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error("Claude response から JSON を抽出できませんでした。");
  }

  return responseText.slice(startIndex, endIndex + 1);
}

async function writePowerPoint(slideDeck: SlideDeck): Promise<void> {
  await fs.mkdir(outputDirPath, { recursive: true });

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Codex";
  pptx.company = "OpenAI";
  pptx.subject = slideDeck.deckTitle;
  pptx.title = slideDeck.deckTitle;
  pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
  };

  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: "F7F4EA" };
  titleSlide.addText(slideDeck.deckTitle, {
    x: 0.8,
    y: 1.1,
    w: 11.2,
    h: 0.8,
    fontFace: "Aptos Display",
    fontSize: 24,
    bold: true,
    color: "17324D",
  });
  titleSlide.addText(slideDeck.subtitle || "Claude Skills API を用いた生成結果", {
    x: 0.8,
    y: 2.0,
    w: 11.2,
    h: 0.5,
    fontFace: "Aptos",
    fontSize: 11,
    color: "486581",
  });

  for (const slideData of slideDeck.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFDF8" };
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 13.33,
      h: 0.55,
      fill: { color: "17324D" },
      line: { color: "17324D" },
    });
    slide.addText(slideData.title, {
      x: 0.75,
      y: 0.9,
      w: 11.8,
      h: 0.5,
      fontFace: "Aptos Display",
      fontSize: 21,
      bold: true,
      color: "17324D",
    });
    slide.addText(
      slideData.bullets.map((bullet) => ({
        text: bullet,
        options: { bullet: { indent: 14 } },
      })),
      {
        x: 1.0,
        y: 1.75,
        w: 11.3,
        h: 4.8,
        fontFace: "Aptos",
        fontSize: 16,
        color: "243B53",
        breakLine: true,
        paraSpaceAfter: 14,
        valign: "top",
      },
    );
  }

  await pptx.writeFile({ fileName: outputPptxPath });
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
