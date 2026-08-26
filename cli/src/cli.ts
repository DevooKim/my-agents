import { extractRepositoryOption, resolveRepositoryRoot } from "./repository";
import { isInteractive, selectSkills } from "./tui";
import {
  listSourceSkills,
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
  yes: boolean;
}

interface ManagedSkill {
  name: string;
  source?: string | undefined;
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
  let yes = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--all") all = true;
    else if (arg === "--local") local = true;
    else if (arg.startsWith("-")) {
      flags.push(arg);
      if (arg === "-g" || arg === "--global") global = true;
      if (arg === "-y" || arg === "--yes") yes = true;
      if (VALUE_FLAGS.has(arg) && i + 1 < argv.length) flags.push(argv[++i]!);
    } else skills.push(arg);
  }
  return { skills, flags, all, global, local, yes };
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

/** skills CLI는 `-s a,b`를 인식하지 못하므로 스킬마다 -s를 반복한다. */
export function skillFlags(names: string[]): string[] {
  return names.flatMap((name) => ["-s", name]);
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

async function managedSkills(global: boolean, repoRoot?: string): Promise<ManagedSkill[]> {
  const home = process.env.HOME;
  if (global && !home) return [];
  const lockPath = global ? `${home}/.agents/.skill-lock.json` : `${process.cwd()}/skills-lock.json`;
  const file = Bun.file(lockPath);
  if (!(await file.exists())) return [];
  const lock = (await file.json()) as { skills?: Record<string, { source?: string }> };
  const targets = [SOURCE_REPO.toLowerCase(), ...(repoRoot ? [repoRoot.toLowerCase()] : [])];
  return Object.entries(lock.skills ?? {})
    .filter(([, meta]) => targets.some((target) => (meta.source ?? "").toLowerCase().includes(target)))
    .map(([name, meta]) => ({ name, source: meta.source }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function resolveTargets(requested: string[], managed: ManagedSkill[]): string[] {
  const names = managed.map((skill) => skill.name);
  if (requested.length === 0) return names;
  const managedSet = new Set(names);
  for (const name of requested.filter((skill) => !managedSet.has(skill))) {
    console.warn(`⚠ '${name}'은 devookim-skills로 설치되지 않아 건너뜁니다.`);
  }
  return requested.filter((skill) => managedSet.has(skill));
}

/** TUI를 띄울 조건: 스킬 미지정 + TTY + --all/-y 같은 비대화 플래그 없음. */
function shouldPrompt(parsed: Parsed): boolean {
  return parsed.skills.length === 0 && !parsed.all && !parsed.yes && isInteractive();
}

async function promptForAdd(source: string, ref?: string): Promise<string[] | undefined> {
  process.stderr.write(`${source}의 스킬 목록을 가져오는 중…\n`);
  const available = await listSourceSkills(source, ref);
  if (available.length === 0) {
    console.log("설치할 수 있는 스킬이 없습니다.");
    return [];
  }
  return selectSkills({
    title: `설치할 스킬 선택 (${source})`,
    choices: available.map((skill) => ({ name: skill.name, hint: skill.description })),
  });
}

/** 로컬 경로 소스는 길고 상대 경로라 마지막 디렉터리 이름만 힌트로 보여준다. */
export function sourceHint(source?: string): string | undefined {
  if (!source) return undefined;
  if (/^[\w.-]+\/[\w.-]+$/.test(source)) return source;
  return source.split("/").filter(Boolean).pop();
}

async function promptForManaged(command: string, managed: ManagedSkill[]): Promise<string[] | undefined> {
  const label = command === "remove" ? "삭제" : "업데이트";
  return selectSkills({
    title: `${label}할 스킬 선택`,
    choices: managed.map((skill) => ({ name: skill.name, hint: sourceHint(skill.source) })),
  });
}

function usage(): void {
  console.log(`devookim-skills — ${SOURCE_REPO}의 스킬 설치 및 외부 스킬 vendoring

사용법:
  bunx devookim-skills find
  bunx devookim-skills add [skill...] [--all] [--local] [-g] [-y]
  bunx devookim-skills update [skill...] [-g] [-y]
  bunx devookim-skills remove [skill...] [-g] [-y]
  bunx devookim-skills vendor add <source> [-s skill] [--all] [--ref ref]
  bunx devookim-skills vendor list
  bunx devookim-skills vendor check [skill...] [--ref ref]
  bunx devookim-skills vendor update [skill...] [--all] [--ref ref]
  bunx devookim-skills vendor continue <skill>
  bunx devookim-skills vendor remove <skill...> [--all] [-y]

대화형 선택:
  add / update / remove를 스킬 이름 없이 TTY에서 실행하면 스킬 목록 TUI가 열립니다.
  --all 또는 -y를 주면 TUI 없이 바로 진행합니다.

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

      let targets = parsed.skills;
      if (shouldPrompt(parsed)) {
        const picked = await promptForAdd(source);
        if (picked === undefined) {
          console.log("취소했습니다.");
          return 130;
        }
        targets = picked;
      }
      if (targets.length === 0) {
        if (parsed.skills.length === 0 && !shouldPrompt(parsed)) {
          usage();
          console.log("\n설치 가능한 스킬 목록:\n");
          return runSkillsCli(["add", source, "-l", ...parsed.flags]);
        }
        console.log("선택한 스킬이 없습니다.");
        return 0;
      }
      return runSkillsCli(["add", source, ...skillFlags(targets), ...parsed.flags]);
    }
    case "remove":
    case "update": {
      const repoRoot = parsed.local ? await resolveRepositoryRoot(extracted.repo) : undefined;
      const managed = await managedSkills(parsed.global, repoRoot);
      if (managed.length === 0) {
        console.log("대상 스킬이 없습니다.");
        return parsed.skills.length ? 1 : 0;
      }
      if (shouldPrompt(parsed)) {
        const picked = await promptForManaged(command, managed);
        if (picked === undefined) {
          console.log("취소했습니다.");
          return 130;
        }
        if (picked.length === 0) {
          console.log("선택한 스킬이 없습니다.");
          return 0;
        }
        return runSkillsCli([command, ...picked, ...parsed.flags]);
      }
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
