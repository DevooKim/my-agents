import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { selectSkills } from "../src/tui";

const CHOICES = [{ name: "alpha" }, { name: "beta", hint: "설명" }, { name: "gamma" }];

function harness(columns = 120): {
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
  written: () => string;
  press: (...keys: string[]) => void;
} {
  const input = new PassThrough() as unknown as NodeJS.ReadStream;
  input.isTTY = true;
  input.setRawMode = () => input;
  const chunks: string[] = [];
  const output = {
    columns,
    isTTY: true,
    write: (chunk: string) => {
      chunks.push(chunk);
      return true;
    },
  } as unknown as NodeJS.WriteStream;
  return {
    input,
    output,
    written: () => chunks.join(""),
    press: (...keys: string[]) => {
      for (const key of keys) (input as unknown as PassThrough).write(key);
    },
  };
}

async function pick(keys: string[], preselected?: string[]): Promise<string[] | undefined> {
  const { input, output, press } = harness();
  const promise = selectSkills({
    title: "선택",
    choices: CHOICES,
    input,
    output,
    ...(preselected ? { preselected } : {}),
  });
  press(...keys);
  return promise;
}

describe("selectSkills", () => {
  test("space로 고른 항목을 enter로 확정한다", async () => {
    expect(await pick([" ", "\r"])).toEqual(["alpha"]);
  });

  test("방향키로 이동한 뒤 여러 개를 선택한다", async () => {
    expect(await pick([" ", "\u001b[B", "\u001b[B", " ", "\r"])).toEqual(["alpha", "gamma"]);
  });

  test("j/k로도 이동한다", async () => {
    expect(await pick(["j", " ", "k", " ", "\r"])).toEqual(["alpha", "beta"]);
  });

  test("a는 전체 선택, 다시 누르면 전체 해제", async () => {
    expect(await pick(["a", "\r"])).toEqual(["alpha", "beta", "gamma"]);
    expect(await pick(["a", "a", "\r"])).toEqual([]);
  });

  test("space를 두 번 누르면 선택이 해제된다", async () => {
    expect(await pick([" ", " ", "\r"])).toEqual([]);
  });

  test("아무것도 고르지 않고 enter를 누르면 빈 배열", async () => {
    expect(await pick(["\r"])).toEqual([]);
  });

  test("esc / q / ctrl-c는 취소로 undefined를 반환한다", async () => {
    expect(await pick(["\u001b"])).toBeUndefined();
    expect(await pick(["q"])).toBeUndefined();
    expect(await pick(["\u0003"])).toBeUndefined();
  });

  test("preselected 항목은 미리 체크된 상태로 시작한다", async () => {
    expect(await pick(["\r"], ["beta"])).toEqual(["beta"]);
  });

  test("한 번에 들어온 키 시퀀스도 개별 키로 처리한다", async () => {
    expect(await pick([" \u001b[B \r"])).toEqual(["alpha", "beta"]);
  });

  test("선택지가 없으면 입력 없이 빈 배열을 반환한다", async () => {
    const { input, output } = harness();
    expect(await selectSkills({ title: "선택", choices: [], input, output })).toEqual([]);
  });

  test("선택지와 hint를 렌더링하고 커서를 복원한다", async () => {
    const { input, output, written, press } = harness();
    const promise = selectSkills({ title: "선택할 스킬", choices: CHOICES, input, output });
    press("\r");
    await promise;
    const text = written();
    expect(text).toContain("선택할 스킬");
    expect(text).toContain("alpha");
    expect(text).toContain("설명");
    expect(text).toContain("\u001b[?25l");
    expect(text).toContain("\u001b[?25h");
  });
});

describe("redraw 커서 정합성", () => {
  // 프레임이 한 줄씩 쌓이던 버그: 마지막 줄에 개행을 쓰면 커서가 블록 아래로
  // 내려가는데 위로는 줄 수만큼만 올라가 매 redraw마다 한 줄씩 어긋났다.
  // 규칙 — 프레임은 개행으로 끝나지 않고, 되돌아가는 양은 "줄 수 - 1"이어야 한다.
  test("프레임을 개행으로 끝내지 않고 줄 수 - 1 만큼만 되돌아간다", async () => {
    const { input, output, written, press } = harness();
    const promise = selectSkills({ title: "T", choices: CHOICES, input, output });
    press("\u001b[B");
    press("\r");
    await promise;

    const text = written();
    const lines = 2 + CHOICES.length; // 제목 + 힌트 + 선택지
    expect(text).toContain(`\r\u001b[${lines - 1}A\u001b[0J`);
    expect(text).not.toContain(`\u001b[${lines}A`);

    // 첫 프레임은 개행으로 끝나지 않아야 한다 (그래야 커서가 마지막 줄에 남는다).
    const firstFrame = text.slice(text.indexOf("T"), text.indexOf("\r\u001b["));
    expect(firstFrame.endsWith("\n")).toBe(false);
  });

  test("커서 이동을 여러 번 해도 프레임이 쌓이지 않는다", async () => {
    const { input, output, written, press } = harness();
    const promise = selectSkills({ title: "UNIQUE_TITLE", choices: CHOICES, input, output });
    press("\u001b[B", "\u001b[B", " ", "\u001b[A");
    press("\r");
    await promise;

    const text = written();
    const titles = text.split("UNIQUE_TITLE").length - 1;
    const clears = text.split("\u001b[0J").length - 1;
    // 제목을 그린 횟수 = 첫 프레임 + 되돌아가 지운 횟수
    expect(titles).toBe(clears + 1);
  });
});

describe("줄바꿈 방지", () => {
  // 어떤 줄이든 터미널 폭을 넘으면 줄바꿈되어 물리 행 수가 논리 줄 수보다 커지고,
  // redraw의 커서 되돌림이 어긋나 프레임이 한 줄씩 쌓인다.
  // 특히 제목·도움말 줄이 truncate에서 빠져 있던 것이 원인이었다.
  const wide = (value: string): number => {
    let width = 0;
    for (const char of value) {
      const code = char.codePointAt(0)!;
      width +=
        code >= 0x1100 &&
        (code <= 0x115f ||
          (code >= 0x2e80 && code <= 0xa4cf) ||
          (code >= 0xac00 && code <= 0xd7a3) ||
          (code >= 0x1f300 && code <= 0x1faff))
          ? 2
          : 1;
    }
    return width;
  };

  test("긴 제목도 터미널 폭 안으로 잘린다", async () => {
    const longTitle = "설치할 스킬 선택 (/Users/someone/Dev/settings/my-agents)";
    for (const columns of [30, 40, 60]) {
      const { input, output, written, press } = harness(columns);
      const promise = selectSkills({ title: longTitle, choices: CHOICES, input, output });
      press("\u001b[B");
      press("\r");
      await promise;
      const plain = written().replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
      for (const line of plain.split(/[\n\r]/)) {
        expect(wide(line)).toBeLessThanOrEqual(columns);
      }
    }
  });

  test("긴 hint도 터미널 폭 안으로 잘린다", async () => {
    const columns = 40;
    const { input, output, written, press } = harness(columns);
    const promise = selectSkills({
      title: "T",
      choices: [{ name: "a", hint: "x".repeat(120) }, { name: "b" }],
      input,
      output,
    });
    press("\r");
    await promise;
    const plain = written().replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
    for (const line of plain.split(/[\n\r]/)) {
      expect(wide(line)).toBeLessThanOrEqual(columns);
    }
  });
});
