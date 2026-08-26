import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const REPO_ENV = "DEVOOKIM_SKILLS_REPO";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function isRepositoryRoot(path: string): Promise<boolean> {
  try {
    const packageJson = JSON.parse(await readFile(join(path, "cli/package.json"), "utf8")) as {
      name?: string;
    };
    return packageJson.name === "devookim-skills" && (await exists(join(path, "skills")));
  } catch {
    return false;
  }
}

async function findUpward(start: string): Promise<string | undefined> {
  let current = resolve(start);
  while (true) {
    if (await isRepositoryRoot(current)) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export async function resolveRepositoryRoot(
  explicitPath?: string,
  cwd = process.cwd(),
  env = process.env,
): Promise<string> {
  const configured = explicitPath || env[REPO_ENV];
  if (configured) {
    const candidate = resolve(cwd, configured);
    if (await isRepositoryRoot(candidate)) return candidate;
    const source = explicitPath ? "--repo" : REPO_ENV;
    throw new Error(`${source} 경로가 my-agents 저장소가 아닙니다: ${candidate}`);
  }

  const discovered = await findUpward(cwd);
  if (discovered) return discovered;
  throw new Error(
    `my-agents 저장소를 찾을 수 없습니다. 저장소 루트에서 실행하거나 ${REPO_ENV} 또는 --repo <path>를 지정하세요.`,
  );
}

export function extractRepositoryOption(args: string[]): { args: string[]; repo?: string } {
  const remaining: string[] = [];
  let repo: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--repo") {
      const value = args[++i];
      if (!value) throw new Error("--repo에는 경로가 필요합니다.");
      repo = value;
    } else if (arg.startsWith("--repo=")) {
      repo = arg.slice("--repo=".length);
    } else {
      remaining.push(arg);
    }
  }
  return repo ? { args: remaining, repo } : { args: remaining };
}
