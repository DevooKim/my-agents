import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLock } from "../src/lock";
import { run } from "../src/process";
import { parseSource, vendorAdd, vendorContinue, vendorUpdate } from "../src/vendor";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function makeUpstream(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "devookim-upstream-test-"));
  temporaryPaths.push(root);
  await run(["git", "init", "--quiet"], { cwd: root, quiet: true });
  await run(["git", "config", "user.name", "test"], { cwd: root, quiet: true });
  await run(["git", "config", "user.email", "test@example.com"], { cwd: root, quiet: true });
  await mkdir(join(root, "skills/demo"), { recursive: true });
  await writeFile(
    join(root, "skills/demo/SKILL.md"),
    "---\nname: demo\ndescription: demo\n---\n\n# Demo\n\nUpstream base.\n",
  );
  await writeFile(join(root, "skills/demo/reference.md"), "base\n");
  await run(["git", "add", "."], { cwd: root, quiet: true });
  await run(["git", "commit", "--quiet", "-m", "initial"], { cwd: root, quiet: true });
  return root;
}

async function makeTarget(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "devookim-target-test-"));
  temporaryPaths.push(root);
  await mkdir(join(root, "cli"), { recursive: true });
  await mkdir(join(root, "skills"), { recursive: true });
  await writeFile(join(root, "cli/package.json"), JSON.stringify({ name: "devookim-skills" }));
  return root;
}

describe("parseSource", () => {
  test("GitHub tree URL에서 저장소, ref, 하위 경로를 분리한다", () => {
    expect(parseSource("https://github.com/owner/repo/tree/main/skills/demo")).toMatchObject({
      cloneUrl: "https://github.com/owner/repo.git",
      source: "owner/repo",
      sourceType: "github",
      ref: "main",
      subpath: "skills/demo",
    });
  });
});

test("vendor add는 파일과 정확한 commit을 함께 기록한다", async () => {
  const upstream = await makeUpstream();
  const target = await makeTarget();
  await vendorAdd(upstream, { repoRoot: target, skills: ["demo"] });
  expect(await readFile(join(target, "skills/vendor/demo/reference.md"), "utf8")).toBe("base\n");
  const lock = await readLock(target);
  const head = (await run(["git", "-C", upstream, "rev-parse", "HEAD"], { quiet: true })).stdout.trim();
  expect(lock.skills.demo?.ref).toBe(head);
  expect(lock.skills.demo?.skillPath).toBe("skills/demo/SKILL.md");
});

test("vendor update는 로컬 수정과 upstream 수정을 3-way merge한다", async () => {
  const upstream = await makeUpstream();
  const target = await makeTarget();
  await vendorAdd(upstream, { repoRoot: target, skills: ["demo"] });

  const localSkill = join(target, "skills/vendor/demo/SKILL.md");
  await writeFile(localSkill, `${await readFile(localSkill, "utf8")}\nLocal addition.\n`);
  await writeFile(join(upstream, "skills/demo/reference.md"), "upstream v2\n");
  await run(["git", "add", "."], { cwd: upstream, quiet: true });
  await run(["git", "commit", "--quiet", "-m", "upstream update"], { cwd: upstream, quiet: true });

  await vendorUpdate({ repoRoot: target, skills: ["demo"] });
  expect(await readFile(localSkill, "utf8")).toContain("Local addition.");
  expect(await readFile(join(target, "skills/vendor/demo/reference.md"), "utf8")).toBe("upstream v2\n");
  const newHead = (await run(["git", "-C", upstream, "rev-parse", "HEAD"], { quiet: true })).stdout.trim();
  expect((await readLock(target)).skills.demo?.ref).toBe(newHead);
});

test("충돌이 해결되기 전에는 lockfile을 갱신하지 않는다", async () => {
  const upstream = await makeUpstream();
  const target = await makeTarget();
  await vendorAdd(upstream, { repoRoot: target, skills: ["demo"] });
  const previousRef = (await readLock(target)).skills.demo!.ref;

  const localSkill = join(target, "skills/vendor/demo/SKILL.md");
  const original = await readFile(localSkill, "utf8");
  await writeFile(localSkill, original.replace("Upstream base.", "Local replacement."));
  await writeFile(join(upstream, "skills/demo/SKILL.md"), original.replace("Upstream base.", "Upstream replacement."));
  await run(["git", "add", "."], { cwd: upstream, quiet: true });
  await run(["git", "commit", "--quiet", "-m", "conflicting update"], { cwd: upstream, quiet: true });

  await vendorUpdate({ repoRoot: target, skills: ["demo"] });
  expect(process.exitCode).toBe(1);
  process.exitCode = 0;
  expect((await readLock(target)).skills.demo?.ref).toBe(previousRef);
  expect(await readFile(localSkill, "utf8")).toContain("<<<<<<< HEAD");

  await writeFile(localSkill, original.replace("Upstream base.", "Resolved replacement."));
  await vendorContinue("demo", target);
  expect((await readLock(target)).skills.demo?.ref).not.toBe(previousRef);
});
