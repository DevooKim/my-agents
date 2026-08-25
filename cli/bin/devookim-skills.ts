#!/usr/bin/env bun

const SOURCE_REPO = "DevooKim/my-agents";

// vercel-labs/skills 플래그 중 값을 하나 받는 것들 (passthrough 시 값까지 함께 넘긴다)
const VALUE_FLAGS = new Set(["-a", "--agent", "-s", "--skill", "--metadata", "--subagent"]);

interface Parsed {
  skills: string[];
  flags: string[];
  all: boolean;
  global: boolean;
}

function parseArgs(argv: string[]): Parsed {
  const skills: string[] = [];
  const flags: string[] = [];
  let all = false;
  let global = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--all") {
      all = true;
      continue;
    }
    if (arg.startsWith("-")) {
      flags.push(arg);
      if (arg === "-g" || arg === "--global") global = true;
      if (VALUE_FLAGS.has(arg) && i + 1 < argv.length) flags.push(argv[++i]);
    } else {
      skills.push(arg);
    }
  }
  return { skills, flags, all, global };
}

async function runSkillsCli(args: string[]): Promise<number> {
  const proc = Bun.spawn(["bunx", "skills", ...args], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}

// skills-lock에서 SOURCE_REPO 출신 스킬만 골라낸다 (devookim-skills가 관리하는 대상)
async function managedSkills(global: boolean): Promise<string[]> {
  const lockPath = global
    ? `${process.env.HOME}/.agents/.skill-lock.json`
    : `${process.cwd()}/skills-lock.json`;
  const file = Bun.file(lockPath);
  if (!(await file.exists())) return [];
  const lock = (await file.json()) as {
    skills?: Record<string, { source?: string }>;
  };
  const target = SOURCE_REPO.toLowerCase();
  return Object.entries(lock.skills ?? {})
    .filter(([, meta]) => (meta.source ?? "").toLowerCase().includes(target))
    .map(([name]) => name);
}

function resolveTargets(requested: string[], managed: string[]): string[] {
  if (requested.length === 0) return managed;
  const managedSet = new Set(managed);
  const unmanaged = requested.filter((s) => !managedSet.has(s));
  for (const name of unmanaged) {
    console.warn(`⚠ '${name}'은(는) ${SOURCE_REPO}에서 설치된 스킬이 아니라 건너뜁니다.`);
  }
  return requested.filter((s) => managedSet.has(s));
}

function usage(): void {
  console.log(`devookim-skills — ${SOURCE_REPO}의 스킬을 관리하는 vercel-labs/skills 래퍼

사용법:
  bunx devookim-skills add <skill...>     스킬 설치 (--all: 레포의 전체 스킬)
  bunx devookim-skills remove [skill...]  설치한 스킬 삭제 (무인자: 전체)
  bunx devookim-skills update [skill...]  설치한 스킬 업데이트 (무인자: 전체)
  bunx devookim-skills find               레포의 스킬 목록 조회
  bunx devookim-skills help               이 도움말 출력 (-h, --help)

미인식 플래그(-g, -y, -a 등)는 skills CLI에 그대로 전달됩니다.`);
}

const [command, ...rest] = process.argv.slice(2);
const { skills, flags, all, global: isGlobal } = parseArgs(rest);

let exitCode = 0;

switch (command) {
  case "add": {
    if (all) {
      exitCode = await runSkillsCli(["add", SOURCE_REPO, "-s", "*", ...flags]);
    } else if (skills.length === 0) {
      usage();
      console.log(`\n설치 가능한 스킬 목록:\n`);
      exitCode = await runSkillsCli(["add", SOURCE_REPO, "-l", ...flags]);
    } else {
      exitCode = await runSkillsCli(["add", SOURCE_REPO, "-s", skills.join(","), ...flags]);
    }
    break;
  }
  case "remove":
  case "update": {
    const managed = await managedSkills(isGlobal);
    if (managed.length === 0) {
      console.log(`${SOURCE_REPO}에서 설치된 스킬이 없습니다.`);
      break;
    }
    const targets = resolveTargets(skills, managed);
    if (targets.length === 0) {
      console.log("대상 스킬이 없습니다.");
      exitCode = 1;
      break;
    }
    exitCode = await runSkillsCli([command, ...targets, ...flags]);
    break;
  }
  case "find": {
    exitCode = await runSkillsCli(["add", SOURCE_REPO, "-l", ...flags]);
    break;
  }
  case "help":
  case "--help":
  case "-h":
  case undefined: {
    usage();
    break;
  }
  default: {
    console.error(`알 수 없는 커맨드: ${command}\n`);
    usage();
    exitCode = 1;
  }
}

process.exit(exitCode);
