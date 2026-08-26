import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractRepositoryOption, resolveRepositoryRoot } from "../src/repository";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixtureRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "devookim-repo-test-"));
  temporaryPaths.push(root);
  await mkdir(join(root, "cli"), { recursive: true });
  await mkdir(join(root, "skills"), { recursive: true });
  await writeFile(join(root, "cli/package.json"), JSON.stringify({ name: "devookim-skills" }));
  return root;
}

describe("resolveRepositoryRoot", () => {
  test("--repo 경로를 환경변수보다 우선한다", async () => {
    const explicit = await fixtureRepo();
    const configured = await fixtureRepo();
    expect(await resolveRepositoryRoot(explicit, "/", { DEVOOKIM_SKILLS_REPO: configured })).toBe(explicit);
  });

  test("환경변수 경로를 사용한다", async () => {
    const configured = await fixtureRepo();
    expect(await resolveRepositoryRoot(undefined, "/", { DEVOOKIM_SKILLS_REPO: configured })).toBe(configured);
  });

  test("현재 경로의 상위에서 저장소를 찾는다", async () => {
    const root = await fixtureRepo();
    const nested = join(root, "a/b/c");
    await mkdir(nested, { recursive: true });
    expect(await resolveRepositoryRoot(undefined, nested, {})).toBe(root);
  });
});

test("extractRepositoryOption은 두 표기법을 제거한다", () => {
  expect(extractRepositoryOption(["update", "--repo", "/one", "skill"])).toEqual({
    args: ["update", "skill"],
    repo: "/one",
  });
  expect(extractRepositoryOption(["--repo=/two", "list"])).toEqual({ args: ["list"], repo: "/two" });
});
