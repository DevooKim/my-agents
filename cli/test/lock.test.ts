import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashDirectory, readLock, writeLock } from "../src/lock";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("디렉터리 해시는 파일 순서와 무관하게 결정적이다", async () => {
  const root = await mkdtemp(join(tmpdir(), "devookim-hash-test-"));
  temporaryPaths.push(root);
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "z.txt"), "z");
  await writeFile(join(root, "nested/a.txt"), "a");
  expect(await hashDirectory(root)).toBe(await hashDirectory(root));
});

test("lockfile은 스킬 이름 순으로 기록된다", async () => {
  const root = await mkdtemp(join(tmpdir(), "devookim-lock-test-"));
  temporaryPaths.push(root);
  await writeLock(root, {
    version: 1,
    skills: {
      z: { source: "z/repo", sourceType: "github", computedHash: "z" },
      a: { source: "a/repo", sourceType: "github", computedHash: "a" },
    },
  });
  expect(Object.keys((await readLock(root)).skills)).toEqual(["a", "z"]);
});
