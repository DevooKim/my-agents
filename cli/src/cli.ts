import { extractRepositoryOption, resolveRepositoryRoot } from "./repository";
import {
  vendorAdd,
  vendorCheck,
  vendorContinue,
  vendorList,
  vendorRemove,
  vendorUpdate,
} from "./vendor";

const SOURCE_REPO = "DevooKim/my-agents";
const VALUE_FLAGS = new Set(["-a", "--agent", "-s", "--skill", "--metadata", "--subagent"]);

interface Parsed {
  skills: string[];
  flags: string[];
  all: boolean;
  global: boolean;
  local: boolean;
}

interface VendorParsed {
  positional: string[];
  skills: string[];
  all: boolean;
  ref?: string | undefined;
  yes: boolean;
}

function parseArgs(argv: string[]): Parsed {
  const skills: string[] = [];
  const flags: string[] = [];
  let all = false;
  let global = false;
  let local = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--all") all = true;
    else if (arg === "--local") local = true;
    else if (arg.startsWith("-")) {
      flags.push(arg);
      if (arg === "-g" || arg === "--global") global = true;
      if (VALUE_FLAGS.has(arg) && i + 1 < argv.length) flags.push(argv[++i]!);
    } else skills.push(arg);
  }
  return { skills, flags, all, global, local };
}

function parseVendorArgs(argv: string[]): VendorParsed {
  const positional: string[] = [];
  const skills: string[] = [];
  let all = false;
  let ref: string | undefined;
  let yes = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--all") all = true;
    else if (arg === "-y" || arg === "--yes") yes = true;
    else if (arg === "-s" || arg === "--skill") {
      const value = argv[++i];
      if (!value) throw new Error(`${arg}에는 스킬 이름이 필요합니다.`);
      skills.push(...value.split(",").filter(Boolean));
    } else if (arg.startsWith("--skill=")) skills.push(...arg.slice(8).split(",").filter(Boolean));
    else if (arg === "--ref") {
      ref = argv[++i];
      if (!ref) throw new Error("--ref에는 branch, tag 또는 commit이 필요합니다.");
    } else if (arg.startsWith("--ref=")) ref = arg.slice(6);
    else if (arg.startsWith("-")) throw new Error(`지원하지 않는 vendor 옵션입니다: ${arg}`);
    else positional.push(arg);
  }
  return { positional, skills, all, ref, yes };
}

async function runSkillsCli(args: string[]): Promise<number> {
  const proc = Bun.spawn(["bunx", "skills", ...args], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return proc.exited;
}

async function protectVendorLock(global: boolean): Promise<void> {
  if (global) return;
  try {
    const repoRoot = await resolveRepositoryRoot(undefined, process.cwd(), {});
    throw new Error(
      `my-agents 내부의 skills-lock.json은 vendoring 전용입니다. 전역 설치에는 -g를 사용하고, 프로젝트 설치는 대상 프로젝트 디렉터리에서 실행하세요: ${repoRoot}`,
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("my-agents 내부의")) throw error;
  }
}

async function managedSkills(global: boolean, repoRoot?: string): Promise<string[]> {
  const home = process.env.HOME;
  if (global && !home) return [];
  const lockPath = global ? `${home}/.agents/.skill-lock.json` : `${process.cwd()}/skills-lock.json`;
  const file = Bun.file(lockPath);
  if (!(await file.exists())) return [];
  const lock = (await file.json()) as { skills?: Record<string, { source?: string }> };
  const targets = [SOURCE_REPO.toLowerCase(), ...(repoRoot ? [repoRoot.toLowerCase()] : [])];
  return Object.entries(lock.skills ?? {})
    .filter(([, meta]) => targets.some((target) => (meta.source ?? "").toLowerCase().includes(target)))
    .map(([name]) => name);
}

function resolveTargets(requested: string[], managed: string[]): string[] {
  if (requested.length === 0) return managed;
  const managedSet = new Set(managed);
  for (const name of requested.filter((skill) => !managedSet.has(skill))) {
    console.warn(`⚠ '${name}'은 devookim-skills로 설치되지 않아 건너뜁니다.`);
  }
  return requested.filter((skill) => managedSet.has(skill));
}

function usage(): void {
  console.log(`devookim-skills — ${SOURCE_REPO}의 스킬 설치 및 외부 스킬 vendoring

사용법:
  bunx devookim-skills find
  bunx devookim-skills add <skill...> [--all] [--local] [-g] [-y]
  bunx devookim-skills update [skill...] [-g] [-y]
  bunx devookim-skills remove [skill...] [-g] [-y]
  bunx devookim-skills vendor add <source> [-s skill] [--all] [--ref ref]
  bunx devookim-skills vendor list
  bunx devookim-skills vendor check [skill...] [--ref ref]
  bunx devookim-skills vendor update [skill...] [--all] [--ref ref]
  bunx devookim-skills vendor continue <skill>
  bunx devookim-skills vendor remove <skill...> [--all] [-y]

저장소 경로 우선순위:
  --repo <path> > DEVOOKIM_SKILLS_REPO > 현재 경로부터 상위 탐색`);
}

async function handleVendor(rawArgs: string[]): Promise<number> {
  const extracted = extractRepositoryOption(rawArgs);
  const [command, ...rest] = extracted.args;
  const parsed = parseVendorArgs(rest);
  const repoRoot = await resolveRepositoryRoot(extracted.repo);
  const options = {
    repoRoot,
    skills: parsed.skills.length ? parsed.skills : parsed.positional,
    all: parsed.all,
    ref: parsed.ref,
    yes: parsed.yes,
  };

  switch (command) {
    case "add": {
      const [source, ...unexpected] = parsed.positional;
      if (!source) throw new Error("vendor add에는 외부 source가 필요합니다.");
      if (unexpected.length) throw new Error(`예상하지 못한 인자입니다: ${unexpected.join(" ")}`);
      await vendorAdd(source, { ...options, skills: parsed.skills });
      return 0;
    }
    case "list":
      await vendorList(repoRoot);
      return 0;
    case "check":
      await vendorCheck(options);
      return 0;
    case "update":
      await vendorUpdate(options);
      return Number(process.exitCode) || 0;
    case "continue": {
      const [name] = parsed.positional;
      if (!name || parsed.positional.length !== 1) throw new Error("vendor continue에는 스킬 하나가 필요합니다.");
      await vendorContinue(name, repoRoot);
      return 0;
    }
    case "remove":
      await vendorRemove(options);
      return 0;
    default:
      throw new Error(`알 수 없는 vendor 명령입니다: ${command || "없음"}`);
  }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [command, ...rawRest] = argv;
  if (command === "vendor") return handleVendor(rawRest);

  const extracted = extractRepositoryOption(rawRest);
  const parsed = parseArgs(extracted.args);
  switch (command) {
    case "add": {
      let source = SOURCE_REPO;
      if (parsed.local) source = await resolveRepositoryRoot(extracted.repo);
      else if (extracted.repo) throw new Error("--repo는 add --local 또는 vendor 명령에서만 사용할 수 있습니다.");
      await protectVendorLock(parsed.global);
      if (parsed.all) return runSkillsCli(["add", source, "-s", "*", ...parsed.flags]);
      if (parsed.skills.length === 0) {
        usage();
        console.log("\n설치 가능한 스킬 목록:\n");
        return runSkillsCli(["add", source, "-l", ...parsed.flags]);
      }
      return runSkillsCli(["add", source, "-s", parsed.skills.join(","), ...parsed.flags]);
    }
    case "remove":
    case "update": {
      const repoRoot = parsed.local ? await resolveRepositoryRoot(extracted.repo) : undefined;
      const managed = await managedSkills(parsed.global, repoRoot);
      const targets = resolveTargets(parsed.skills, managed);
      if (targets.length === 0) {
        console.log("대상 스킬이 없습니다.");
        return parsed.skills.length ? 1 : 0;
      }
      return runSkillsCli([command, ...targets, ...parsed.flags]);
    }
    case "find":
      return runSkillsCli(["add", SOURCE_REPO, "-l", ...parsed.flags]);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      usage();
      return 0;
    default:
      console.error(`알 수 없는 커맨드: ${command}\n`);
      usage();
      return 1;
  }
}
