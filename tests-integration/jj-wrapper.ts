import fs from "fs/promises";
import path from "path";
import which from "which";

export interface JJWrapperInvocation {
  event: "invoke" | "failure" | "barrier-complete";
  cwd: string;
  args: string[];
  id?: string;
  timedOut?: boolean;
}

interface FailureRule {
  id: string;
  cwd?: string;
  args: string[];
  stderr: string;
  exitCode?: number;
  claimPath?: string;
}

interface BarrierRule {
  id: string;
  args: string[];
  expected: number;
  timeoutMs: number;
  markerDir: string;
}

interface WrapperControl {
  failure?: FailureRule;
  barrier?: BarrierRule;
}

export class JJTestWrapper {
  constructor(
    readonly executablePath: string,
    private readonly controlPath: string,
    private readonly logPath: string,
  ) {}

  async armFailure(rule: FailureRule): Promise<void> {
    const claimPath = path.join(path.dirname(this.controlPath), `${rule.id}.claim`);
    await fs.rm(claimPath, { force: true });
    const control = await this.readControl();
    control.failure = { ...rule, claimPath };
    await this.writeControl(control);
  }

  async configureBarrier(rule: Omit<BarrierRule, "markerDir">): Promise<void> {
    const control = await this.readControl();
    const markerDir = path.join(path.dirname(this.controlPath), `${rule.id}-markers`);
    await fs.rm(markerDir, { recursive: true, force: true });
    await fs.mkdir(markerDir, { recursive: true });
    control.barrier = { ...rule, markerDir };
    await this.writeControl(control);
  }

  async invocations(): Promise<JJWrapperInvocation[]> {
    let content: string;
    try {
      content = await fs.readFile(this.logPath, "utf-8");
    } catch {
      return [];
    }
    const invocations: JJWrapperInvocation[] = [];
    for (const line of content.split("\n")) {
      if (!line) {
        continue;
      }
      try {
        invocations.push(JSON.parse(line) as JJWrapperInvocation);
      } catch {
        // A concurrent append can leave only the final line temporarily incomplete.
      }
    }
    return invocations;
  }

  private async readControl(): Promise<WrapperControl> {
    try {
      return JSON.parse(await fs.readFile(this.controlPath, "utf-8")) as WrapperControl;
    } catch {
      return {};
    }
  }

  private async writeControl(control: WrapperControl): Promise<void> {
    const tempPath = `${this.controlPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(control));
    await fs.rename(tempPath, this.controlPath);
  }
}

export async function createJJTestWrapper(cachePath: string): Promise<JJTestWrapper> {
  const realJJPath = await which(process.env.JJ_PATH || "jj");
  const scriptPath = path.join(cachePath, "jj-test-wrapper.cjs");
  const controlPath = path.join(cachePath, "jj-test-wrapper-control.json");
  const logPath = path.join(cachePath, "jj-test-wrapper.log");
  const executablePath = path.join(cachePath, process.platform === "win32" ? "jj-test-wrapper.cmd" : "jj-test-wrapper");

  await fs.writeFile(controlPath, "{}");
  await fs.writeFile(
    scriptPath,
    `#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const realJJPath = ${JSON.stringify(realJJPath)};
const controlPath = ${JSON.stringify(controlPath)};
const logPath = ${JSON.stringify(logPath)};
const args = process.argv.slice(2);
const cwd = process.cwd();
const append = (entry) => fs.appendFileSync(logPath, JSON.stringify({ cwd, args, ...entry }) + "\\n");
const containsSequence = (values, sequence) => values.some((_, start) =>
  sequence.every((part, offset) => values[start + offset] === part),
);
const canonicalPath = (value) => {
  let result;
  try { result = fs.realpathSync.native(value); } catch { result = path.resolve(value); }
  return process.platform === "win32" || process.platform === "darwin" ? result.toLowerCase() : result;
};
const matches = (rule) => (!rule.cwd || canonicalPath(rule.cwd) === canonicalPath(cwd)) && containsSequence(args, rule.args);
let control = {};
try { control = JSON.parse(fs.readFileSync(controlPath, "utf-8")); } catch {}
append({ event: "invoke" });
if (control.failure && matches(control.failure)) {
  const failure = control.failure;
  let claimed = false;
  try {
    fs.closeSync(fs.openSync(failure.claimPath, "wx"));
    claimed = true;
  } catch {}
  if (claimed) {
    process.stderr.write(failure.stderr);
    append({ event: "failure", id: failure.id });
    process.exit(failure.exitCode || 1);
  }
}
if (control.barrier && matches(control.barrier)) {
  const barrier = control.barrier;
  fs.mkdirSync(barrier.markerDir, { recursive: true });
  const marker = crypto.createHash("sha1").update(canonicalPath(cwd)).digest("hex");
  fs.writeFileSync(path.join(barrier.markerDir, marker), "");
  const deadline = Date.now() + barrier.timeoutMs;
  while (fs.readdirSync(barrier.markerDir).length < barrier.expected && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  append({
    event: "barrier-complete",
    id: barrier.id,
    timedOut: fs.readdirSync(barrier.markerDir).length < barrier.expected,
  });
}
const result = spawnSync(realJJPath, args, { cwd, env: process.env, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) {
  process.stderr.write(result.error.message);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
`,
    { mode: 0o755 },
  );

  if (process.platform === "win32") {
    await fs.writeFile(executablePath, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`);
  } else {
    await fs.copyFile(scriptPath, executablePath);
    await fs.chmod(executablePath, 0o755);
  }

  return new JJTestWrapper(executablePath, controlPath, logPath);
}
