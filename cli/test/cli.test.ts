import { describe, expect, test } from "bun:test";
import { skillFlags, sourceHint } from "../src/cli";

describe("sourceHint", () => {
  test("owner/repo 형식은 그대로 보여준다", () => {
    expect(sourceHint("DevooKim/my-agents")).toBe("DevooKim/my-agents");
  });

  test("긴 로컬 경로는 마지막 디렉터리만 남긴다", () => {
    expect(sourceHint("../../../Users/me/Dev/settings/my-agents")).toBe("my-agents");
  });

  test("source가 없으면 undefined", () => {
    expect(sourceHint(undefined)).toBeUndefined();
  });
});

describe("skillFlags", () => {
  // skills CLI는 `-s a,b` 콤마 목록을 인식하지 못하고 "No matching skills found"로 실패한다.
  test("스킬마다 -s를 반복한다", () => {
    expect(skillFlags(["grilling", "handoff"])).toEqual(["-s", "grilling", "-s", "handoff"]);
  });

  test("스킬 하나면 -s 한 쌍", () => {
    expect(skillFlags(["grilling"])).toEqual(["-s", "grilling"]);
  });

  test("빈 목록은 빈 배열", () => {
    expect(skillFlags([])).toEqual([]);
  });
});
