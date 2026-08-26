import { existsSync } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { hashDirectory, readLock, writeLock } from "./lock";
import { run } from "./process";
import type { PendingMerge, ResolvedSource, SkillLockEntry } from "./types";

interface VendorOptions {
  repoRoot: string;
  skills?: string[];
  all?: boolean;
  ref?: string | undefined;
  yes?: boolean;
}

interface Checkout {
  root: string;
  commit: string;
  source: ResolvedSource;
  temporary: boolean;
}

const PENDING_DIR = ".devookim-skills/pending";

function stripGitSuffix(value: string): string {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
}

export function parseSource(input: string, explicitRef?: string): ResolvedSource {
  const absolute = resolve(input);
  if (existsSync(absolute)) {
    return { original: input, cloneUrl: absolute, source: absolute, sourceType: "local", ref: explicitRef };
  }

  let raw = input;
  let fragment: string | undefined;
  const hashIndex = raw.lastIndexOf("#");
  if (hashIndex > 0) {
    fragment = raw.slice(hashIndex + 1);
    raw = raw.slice(0, hashIndex);
  }

  const tree = raw.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)\/tree\/([^/]+)(?:\/(.*))?$/);
  if (tree) {
    const ownerRepo = `${tree[1]}/${stripGitSuffix(tree[2]!)}`;
    return {
      original: input,
      cloneUrl: `https://github.com/${ownerRepo}.git`,
      source: ownerRepo,
      sourceType: "github",
      ref: explicitRef || fragment || decodeURIComponent(tree[3]!),
      subpath: tree[4],
    };
  }

  const shorthand = raw.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (shorthand) {
    const ownerRepo = `${shorthand[1]}/${stripGitSuffix(shorthand[2]!)}`;
    return {
      original: input,
      cloneUrl: `https://github.com/${ownerRepo}.git`,
      source: ownerRepo,
      sourceType: "github",
      ref: explicitRef || fragment,
    };
  }

  const github = raw.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (github) {
    const ownerRepo = `${github[1]}/${stripGitSuffix(github[2]!)}`;
    return {
      original: input,
      cloneUrl: `https://github.com/${ownerRepo}.git`,
      source: ownerRepo,
      sourceType: "github",
      ref: explicitRef || fragment,
    };
  }

  return {
    original: input,
    cloneUrl: raw,
    source: raw,
    sourceType: "git",
    ref: explicitRef || fragment,
  };
}

async function checkoutSource(source: ResolvedSource, requestedRef = source.ref): Promise<Checkout> {
  if (source.sourceType === "local") {
    const result = await run(["git", "-C", source.cloneUrl, "rev-parse", requestedRef || "HEAD"], {
      quiet: true,
      allowFailure: true,
    });
    if (result.exitCode !== 0) {
      if (requestedRef) throw new Error(`Git 저장소가 아닌 로컬 소스에는 --ref를 사용할 수 없습니다: ${source.cloneUrl}`);
      return { root: source.cloneUrl, commit: "local", source, temporary: false };
    }
  }

  const root = await mkdtemp(join(tmpdir(), "devookim-skills-source-"));
  await run(["git", "clone", "--quiet", "--filter=blob:none", "--depth=1", "--no-checkout", source.cloneUrl, root], {
    quiet: true,
  });
  let commit: string;
  if (requestedRef) {
    await run(["git", "-C", root, "fetch", "--quiet", "--depth=1", "origin", requestedRef], { quiet: true });
    commit = (await run(["git", "-C", root, "rev-parse", "FETCH_HEAD"], { quiet: true })).stdout.trim();
  } else {
    commit = (await run(["git", "-C", root, "rev-parse", "HEAD"], { quiet: true })).stdout.trim();
  }
  await run(["git", "-C", root, "checkout", "--quiet", "--detach", commit], { quiet: true });
  return { root, commit, source, temporary: true };
}

async function cleanupCheckout(checkout: Checkout): Promise<void> {
  if (checkout.temporary) await rm(checkout.root, { recursive: true, force: true });
}

function parseFrontmatterName(content: string): string | undefined {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  return match?.[1]?.match(/^name:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
}

async function discoverSkills(root: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        const name = parseFrontmatterName(await readFile(path, "utf8")) || basename(dirname(path));
        if (found.has(name)) throw new Error(`중복된 스킬 이름입니다: ${name}`);
        found.set(name, dirname(path));
      }
    }
  }
  await walk(root);
  return found;
}

async function validateSkill(path: string, expectedName: string): Promise<void> {
  const skillFile = join(path, "SKILL.md");
  const stat = await lstat(skillFile).catch(() => undefined);
  if (!stat?.isFile()) throw new Error(`${expectedName}: SKILL.md가 없습니다.`);
  const name = parseFrontmatterName(await readFile(skillFile, "utf8"));
  if (name !== expectedName) throw new Error(`${expectedName}: frontmatter name이 '${name || "없음"}'입니다.`);
  await hashDirectory(path);
}

async function replaceDirectory(source: string, target: string): Promise<void> {
  const backup = `${target}.backup-${crypto.randomUUID()}`;
  const exists = await lstat(target).then(() => true).catch(() => false);
  await mkdir(dirname(target), { recursive: true });
  if (exists) await rename(target, backup);
  try {
    await cp(source, target, { recursive: true, errorOnExist: true });
    if (exists) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    if (exists) await rename(backup, target);
    throw error;
  }
}

function entrySource(entry: SkillLockEntry): ResolvedSource {
  return {
    original: entry.sourceUrl || entry.source,
    cloneUrl: entry.sourceUrl || (entry.sourceType === "github" ? `https://github.com/${entry.source}.git` : entry.source),
    source: entry.source,
    sourceType: entry.sourceType === "github" ? "github" : entry.sourceType === "local" ? "local" : "git",
  };
}

function skillPath(checkout: Checkout, entry: SkillLockEntry): string {
  if (!entry.skillPath) throw new Error("lock entry에 skillPath가 없습니다.");
  const folder = dirname(entry.skillPath);
  const path = resolve(checkout.root, folder);
  if (!path.startsWith(`${resolve(checkout.root)}/`) && path !== resolve(checkout.root)) {
    throw new Error(`잘못된 skillPath입니다: ${entry.skillPath}`);
  }
  return path;
}

export async function vendorAdd(sourceInput: string, options: VendorOptions): Promise<void> {
  const source = parseSource(sourceInput, options.ref);
  const checkout = await checkoutSource(source);
  try {
    const discoveryRoot = source.subpath ? resolve(checkout.root, source.subpath) : checkout.root;
    if (!discoveryRoot.startsWith(`${resolve(checkout.root)}/`) && discoveryRoot !== resolve(checkout.root)) {
      throw new Error(`외부 소스 경로가 저장소를 벗어납니다: ${source.subpath}`);
    }
    const discovered = await discoverSkills(discoveryRoot);
    const names = options.all
      ? [...discovered.keys()]
      : options.skills?.length
        ? options.skills
        : discovered.size === 1
          ? [...discovered.keys()]
          : [];
    if (names.length === 0) throw new Error("가져올 스킬을 -s <name>으로 지정하거나 --all을 사용하세요.");

    const lock = await readLock(options.repoRoot);
    const selected: Array<[string, string]> = [];
    for (const name of names) {
      const path = discovered.get(name);
      if (!path) throw new Error(`외부 소스에서 '${name}' 스킬을 찾지 못했습니다.`);
      await validateSkill(path, name);
      const target = join(options.repoRoot, "skills", name);
      if (lock.skills[name] || (await lstat(target).then(() => true).catch(() => false))) {
        throw new Error(`'${name}'이 이미 존재합니다. vendor update를 사용하세요.`);
      }
      selected.push([name, path]);
    }

    for (const [name, path] of selected) {
      const target = join(options.repoRoot, "skills", name);
      await replaceDirectory(path, target);
      lock.skills[name] = {
        source: source.source,
        sourceUrl: source.cloneUrl,
        sourceType: source.sourceType,
        ref: checkout.commit,
        skillPath: `${relative(checkout.root, path).split("\\").join("/")}/SKILL.md`,
        computedHash: await hashDirectory(target),
      };
      await writeLock(options.repoRoot, lock);
      console.log(`✓ ${name} → skills/${name}`);
    }
  } finally {
    await cleanupCheckout(checkout);
  }
}

export async function vendorList(repoRoot: string): Promise<void> {
  const lock = await readLock(repoRoot);
  const names = Object.keys(lock.skills).sort();
  if (names.length === 0) {
    console.log("등록된 외부 스킬이 없습니다.");
    return;
  }
  for (const name of names) {
    const entry = lock.skills[name]!;
    const path = join(repoRoot, "skills", name);
    const localHash = await hashDirectory(path).catch(() => "missing");
    const status = localHash === "missing" ? "missing" : localHash === entry.computedHash ? "clean" : "modified";
    console.log(`${name}\t${entry.source}\t${entry.ref?.slice(0, 12) || "-"}\t${status}`);
  }
}

async function selectNames(repoRoot: string, requested?: string[], all = false): Promise<Array<[string, SkillLockEntry]>> {
  const lock = await readLock(repoRoot);
  const names = all || !requested?.length ? Object.keys(lock.skills) : requested;
  return names.map((name) => {
    const entry = lock.skills[name];
    if (!entry) throw new Error(`lockfile에 '${name}'이 없습니다.`);
    return [name, entry];
  });
}

async function latestCheckout(entry: SkillLockEntry, requestedRef?: string): Promise<Checkout> {
  return checkoutSource(entrySource(entry), requestedRef);
}

export async function vendorCheck(options: VendorOptions): Promise<void> {
  for (const [name, entry] of await selectNames(options.repoRoot, options.skills, options.all)) {
    const latest = await latestCheckout(entry, options.ref);
    const base = await latestCheckout(entry, entry.ref);
    try {
      const latestHash = await hashDirectory(skillPath(latest, entry));
      const baseHash = await hashDirectory(skillPath(base, entry));
      const localHash = await hashDirectory(join(options.repoRoot, "skills", name)).catch(() => "missing");
      const upstream = latestHash === baseHash ? "up-to-date" : `update ${entry.ref?.slice(0, 8)} → ${latest.commit.slice(0, 8)}`;
      const local = localHash === "missing" ? "missing" : localHash === entry.computedHash ? "clean" : "modified";
      console.log(`${name}\tupstream:${upstream}\tlocal:${local}`);
    } finally {
      await cleanupCheckout(latest);
      await cleanupCheckout(base);
    }
  }
}

async function copyTree(source: string, destination: string): Promise<void> {
  await rm(destination, { recursive: true, force: true });
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}

async function mergeTrees(base: string, ours: string, theirs: string): Promise<{ root: string; conflicts: string[] }> {
  const root = await mkdtemp(join(tmpdir(), "devookim-skills-merge-"));
  const tree = join(root, "skill");
  await run(["git", "init", "--quiet"], { cwd: root, quiet: true });
  await run(["git", "config", "user.name", "devookim-skills"], { cwd: root, quiet: true });
  await run(["git", "config", "user.email", "devookim-skills@local"], { cwd: root, quiet: true });
  await copyTree(base, tree);
  await run(["git", "add", "skill"], { cwd: root, quiet: true });
  await run(["git", "commit", "--quiet", "-m", "base"], { cwd: root, quiet: true });
  const baseCommit = (await run(["git", "rev-parse", "HEAD"], { cwd: root, quiet: true })).stdout.trim();
  await run(["git", "switch", "--quiet", "-c", "ours"], { cwd: root, quiet: true });
  await copyTree(ours, tree);
  await run(["git", "add", "-A"], { cwd: root, quiet: true });
  await run(["git", "commit", "--quiet", "--allow-empty", "-m", "ours"], { cwd: root, quiet: true });
  await run(["git", "switch", "--quiet", "-c", "theirs", baseCommit], { cwd: root, quiet: true });
  await copyTree(theirs, tree);
  await run(["git", "add", "-A"], { cwd: root, quiet: true });
  await run(["git", "commit", "--quiet", "--allow-empty", "-m", "theirs"], { cwd: root, quiet: true });
  await run(["git", "switch", "--quiet", "ours"], { cwd: root, quiet: true });
  const merge = await run(["git", "merge", "--no-commit", "--no-ff", "theirs"], {
    cwd: root,
    quiet: true,
    allowFailure: true,
    env: { GIT_MERGE_AUTOEDIT: "no" },
  });
  const conflicts = merge.exitCode === 0
    ? []
    : (await run(["git", "diff", "--name-only", "--diff-filter=U"], { cwd: root, quiet: true })).stdout
        .split("\n")
        .filter(Boolean)
        .map((path) => path.replace(/^skill\//, ""));
  return { root, conflicts };
}

function pendingPath(repoRoot: string, name: string): string {
  return join(repoRoot, PENDING_DIR, `${name}.json`);
}

export async function vendorUpdate(options: VendorOptions): Promise<void> {
  const lock = await readLock(options.repoRoot);
  for (const [name, entry] of await selectNames(options.repoRoot, options.skills, options.all)) {
    if (!entry.ref) throw new Error(`${name}: 이전 upstream commit(ref)이 없습니다.`);
    const base = await latestCheckout(entry, entry.ref);
    const latest = await latestCheckout(entry, options.ref);
    let mergeRoot: string | undefined;
    try {
      const ours = join(options.repoRoot, "skills", name);
      await validateSkill(ours, name);
      const baseTree = skillPath(base, entry);
      const latestTree = skillPath(latest, entry);
      const result = await mergeTrees(baseTree, ours, latestTree);
      mergeRoot = result.root;
      const mergedTree = join(result.root, "skill");
      await replaceDirectory(mergedTree, ours);
      const nextEntry = { ...entry, ref: latest.commit, computedHash: await hashDirectory(ours) };
      if (result.conflicts.length > 0) {
        const pending: PendingMerge = { version: 1, skill: name, entry: nextEntry, conflicts: result.conflicts };
        await mkdir(join(options.repoRoot, PENDING_DIR), { recursive: true });
        await writeFile(pendingPath(options.repoRoot, name), `${JSON.stringify(pending, null, 2)}\n`);
        console.error(`✗ ${name}: 병합 충돌 (${result.conflicts.join(", ")})`);
        console.error(`  해결 후 devookim-skills vendor continue ${name}을 실행하세요.`);
        process.exitCode = 1;
      } else {
        lock.skills[name] = nextEntry;
        await writeLock(options.repoRoot, lock);
        console.log(`✓ ${name}: ${entry.ref.slice(0, 8)} → ${latest.commit.slice(0, 8)}`);
      }
    } finally {
      if (mergeRoot) await rm(mergeRoot, { recursive: true, force: true });
      await cleanupCheckout(base);
      await cleanupCheckout(latest);
    }
  }
}

async function containsConflictMarkers(root: string): Promise<string[]> {
  const conflicts: string[] = [];
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
        if (bytes.includes(0)) continue;
        const content = new TextDecoder().decode(bytes);
        if (/^(<{7}|={7}|>{7})/m.test(content)) conflicts.push(relative(root, path));
      }
    }
  }
  await walk(root);
  return conflicts;
}

export async function vendorContinue(name: string, repoRoot: string): Promise<void> {
  const file = pendingPath(repoRoot, name);
  const pending = JSON.parse(await readFile(file, "utf8")) as PendingMerge;
  if (pending.version !== 1 || pending.skill !== name) throw new Error(`${name}: 잘못된 pending merge 파일입니다.`);
  const target = join(repoRoot, "skills", name);
  await validateSkill(target, name);
  const markers = await containsConflictMarkers(target);
  if (markers.length > 0) throw new Error(`충돌 마커가 남아 있습니다: ${markers.join(", ")}`);
  const lock = await readLock(repoRoot);
  lock.skills[name] = { ...pending.entry, computedHash: await hashDirectory(target) };
  await writeLock(repoRoot, lock);
  await rm(file, { force: true });
  console.log(`✓ ${name}: 병합 완료`);
}

async function confirmRemoval(name: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question(`'${name}' 스킬과 lock entry를 삭제할까요? [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}

export async function vendorRemove(options: VendorOptions): Promise<void> {
  const lock = await readLock(options.repoRoot);
  const targets = await selectNames(options.repoRoot, options.skills, options.all);
  for (const [name] of targets) {
    if (!options.yes && !(await confirmRemoval(name))) {
      console.log(`- ${name}: 건너뜀`);
      continue;
    }
    await rm(join(options.repoRoot, "skills", name), { recursive: true, force: true });
    delete lock.skills[name];
    await rm(pendingPath(options.repoRoot, name), { force: true });
    console.log(`✓ ${name}: 삭제`);
  }
  await writeLock(options.repoRoot, lock);
}
