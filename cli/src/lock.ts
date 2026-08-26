import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { SkillLock } from "./types";

export const LOCK_FILE = "skills-lock.json";

export async function readLock(repoRoot: string): Promise<SkillLock> {
  try {
    const parsed = JSON.parse(await readFile(join(repoRoot, LOCK_FILE), "utf8")) as SkillLock;
    if (parsed.version !== 1 || !parsed.skills || typeof parsed.skills !== "object") {
      throw new Error("지원하지 않는 lockfile 형식입니다.");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, skills: {} };
    throw error;
  }
}

export async function writeLock(repoRoot: string, lock: SkillLock): Promise<void> {
  const skills = Object.fromEntries(Object.entries(lock.skills).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(join(repoRoot, LOCK_FILE), `${JSON.stringify({ version: 1, skills }, null, 2)}\n`);
}

async function collectFiles(root: string, current: string, output: Array<[string, Uint8Array]>): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = join(current, entry.name);
    const stat = await lstat(fullPath);
    if (stat.isSymbolicLink()) throw new Error(`심볼릭 링크는 vendoring할 수 없습니다: ${relative(root, fullPath)}`);
    if (stat.isDirectory()) {
      await collectFiles(root, fullPath, output);
    } else if (stat.isFile()) {
      output.push([relative(root, fullPath).split("\\").join("/"), new Uint8Array(await Bun.file(fullPath).arrayBuffer())]);
    }
  }
}

export async function hashDirectory(path: string): Promise<string> {
  const files: Array<[string, Uint8Array]> = [];
  await collectFiles(path, path, files);
  const hasher = new Bun.CryptoHasher("sha256");
  for (const [name, content] of files) {
    hasher.update(name);
    hasher.update(content);
  }
  return hasher.digest("hex");
}
