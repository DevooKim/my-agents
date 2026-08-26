export interface Choice {
  name: string;
  hint?: string | undefined;
}

export interface SelectOptions {
  title: string;
  choices: Choice[];
  preselected?: string[];
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
}

const ESC = "\u001b";
const KEY_UP = `${ESC}[A`;
const KEY_DOWN = `${ESC}[B`;

export function isInteractive(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): boolean {
  return Boolean(input.isTTY && output.isTTY && !process.env.CI);
}

/** 한글·이모지 등 2칸을 차지하는 문자를 감안한 표시 폭. */
function displayWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    const code = char.codePointAt(0)!;
    width += code >= 0x1100 &&
      (code <= 0x115f ||
        (code >= 0x2e80 && code <= 0xa4cf) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe30 && code <= 0xfe6f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        (code >= 0x1f300 && code <= 0x1faff))
      ? 2
      : 1;
  }
  return width;
}

/**
 * 표시 폭 기준으로 잘라낸다. 한 줄이라도 터미널 폭을 넘으면 줄바꿈되어
 * 물리 행 수가 논리 줄 수보다 커지고, redraw의 커서 되돌림이 어긋나
 * 프레임이 한 줄씩 쌓인다.
 */
function truncate(value: string, width: number): string {
  if (width <= 1 || displayWidth(value) <= width) return value;
  let result = "";
  let used = 0;
  for (const char of value) {
    const next = used + displayWidth(char);
    if (next > width - 1) break;
    result += char;
    used = next;
  }
  return `${result}…`;
}

function splitKeys(chunk: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < chunk.length; i++) {
    if (chunk[i] === ESC && chunk[i + 1] === "[" && chunk[i + 2]) {
      keys.push(chunk.slice(i, i + 3));
      i += 2;
    } else {
      keys.push(chunk[i]!);
    }
  }
  return keys;
}

function frame(options: SelectOptions, cursor: number, selected: Set<number>, width: number): string[] {
  return [
    truncate(options.title, width),
    truncate("  ↑/↓ 이동 · space 선택 · a 전체 · enter 확인 · esc 취소", width),
    ...options.choices.map((choice, index) => {
      const pointer = index === cursor ? "❯" : " ";
      const mark = selected.has(index) ? "◉" : "◯";
      const hint = choice.hint ? `  ${choice.hint}` : "";
      return truncate(`${pointer} ${mark} ${choice.name}${hint}`, width);
    }),
  ];
}

/**
 * TTY 다중 선택 프롬프트. enter로 확정한 스킬 이름을 반환하고,
 * esc/q/ctrl-c로 취소하면 undefined를 반환한다.
 */
export async function selectSkills(options: SelectOptions): Promise<string[] | undefined> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  if (options.choices.length === 0) return [];

  const preselected = new Set(options.preselected ?? []);
  const selected = new Set(
    options.choices.map((choice, index) => (preselected.has(choice.name) ? index : -1)).filter((index) => index >= 0),
  );
  let cursor = 0;
  let rendered = 0;

  const draw = (): void => {
    if (rendered > 0) output.write(`\r${ESC}[${rendered - 1}A${ESC}[0J`);
    const lines = frame(options, cursor, selected, (output.columns || 80) - 1);
    output.write(lines.join("\n"));
    rendered = lines.length;
  };

  const wasRaw = input.isRaw ?? false;
  input.setRawMode?.(true);
  input.resume();
  input.setEncoding("utf8");
  output.write(`${ESC}[?25l`);

  try {
    draw();
    for await (const chunk of input as AsyncIterable<string>) {
      let confirmed: string[] | undefined;
      let cancelled = false;
      for (const key of splitKeys(chunk)) {
        if (key === "\u0003" || key === "\u0004" || key === ESC || key === "q") {
          cancelled = true;
          break;
        }
        if (key === KEY_UP || key === "k") cursor = (cursor - 1 + options.choices.length) % options.choices.length;
        else if (key === KEY_DOWN || key === "j") cursor = (cursor + 1) % options.choices.length;
        else if (key === " ") {
          if (selected.has(cursor)) selected.delete(cursor);
          else selected.add(cursor);
        } else if (key === "a") {
          if (selected.size === options.choices.length) selected.clear();
          else options.choices.forEach((_, index) => selected.add(index));
        } else if (key === "\r" || key === "\n") {
          confirmed = [...selected].sort((a, b) => a - b).map((index) => options.choices[index]!.name);
          break;
        }
      }
      if (cancelled) return undefined;
      draw();
      if (confirmed) return confirmed;
    }
    return undefined;
  } finally {
    if (rendered > 0) output.write("\n");
    output.write(`${ESC}[?25h`);
    input.setRawMode?.(wasRaw);
    input.pause();
  }
}
