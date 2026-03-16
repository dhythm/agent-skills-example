import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";

export function loadEnvironment(): string[] {
  const loadedFiles: string[] = [];
  const envFiles = [".env", ".env.local"];

  for (const fileName of envFiles) {
    const filePath = path.resolve(process.cwd(), fileName);

    if (!fs.existsSync(filePath)) {
      continue;
    }

    dotenv.config({
      path: filePath,
      override: fileName === ".env.local",
    });
    loadedFiles.push(fileName);
  }

  return loadedFiles;
}
