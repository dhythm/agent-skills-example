import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import matter from "gray-matter";

type SkillScope = "project" | "user";

export type SkillDefinition = {
  name: string;
  description: string;
  path: string;
  scope: SkillScope;
  content: string;
};

type SkillDirectory = {
  dirPath: string;
  scope: SkillScope;
};

export async function loadSkills(): Promise<SkillDefinition[]> {
  const directories: SkillDirectory[] = [
    {
      dirPath: path.resolve(process.cwd(), ".agents/skills"),
      scope: "project",
    },
    {
      dirPath: path.join(os.homedir(), ".agents/skills"),
      scope: "user",
    },
  ];

  const discovered = new Map<string, SkillDefinition>();

  for (const directory of directories) {
    const skills = await readSkillsFromDirectory(directory);

    for (const skill of skills) {
      if (!discovered.has(skill.name) || skill.scope === "project") {
        discovered.set(skill.name, skill);
      }
    }
  }

  return [...discovered.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function readSkillsFromDirectory(
  directory: SkillDirectory,
): Promise<SkillDefinition[]> {
  try {
    const entries = await fs.readdir(directory.dirPath, { withFileTypes: true });
    const skills = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) =>
          readSkill(path.join(directory.dirPath, entry.name), directory.scope),
        ),
    );

    return skills.filter((skill): skill is SkillDefinition => skill !== null);
  } catch (error) {
    const fsError = error as NodeJS.ErrnoException;

    if (fsError.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function readSkill(
  skillDir: string,
  scope: SkillScope,
): Promise<SkillDefinition | null> {
  const skillPath = path.join(skillDir, "SKILL.md");

  try {
    const content = await fs.readFile(skillPath, "utf8");
    const parsed = matter(content);
    const data = parsed.data as { name?: unknown; description?: unknown };
    const name = typeof data.name === "string" ? data.name.trim() : "";
    const description =
      typeof data.description === "string" ? data.description.trim() : "";

    if (!name || !description) {
      return null;
    }

    return {
      name,
      description,
      path: skillPath,
      scope,
      content,
    };
  } catch (error) {
    const fsError = error as NodeJS.ErrnoException;

    if (fsError.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export function formatSkillCatalog(skills: SkillDefinition[]): string {
  const lines = ["<available_skills>"];

  for (const skill of skills) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <scope>${skill.scope}</scope>`);
    lines.push(`    <path>${escapeXml(skill.path)}</path>`);
    lines.push("  </skill>");
  }

  lines.push("</available_skills>");

  return lines.join("\n");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
