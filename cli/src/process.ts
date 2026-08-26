export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  quiet?: boolean;
  allowFailure?: boolean;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function run(command: string[], options: RunOptions = {}): Promise<RunResult> {
  const spawnOptions = {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
    stdin: "inherit" as const,
    stdout: "pipe" as const,
    stderr: "pipe" as const,
  };
  const proc = Bun.spawn(command, {
    ...spawnOptions,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (!options.quiet) {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  }
  if (exitCode !== 0 && !options.allowFailure) {
    const detail = stderr.trim() || stdout.trim() || `exit code ${exitCode}`;
    throw new Error(`${command[0]} 실행 실패: ${detail}`);
  }
  return { exitCode, stdout, stderr };
}
