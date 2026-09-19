/* eslint-disable @typescript-eslint/no-floating-promises */
import assert from "node:assert/strict";
import { EventEmitter as NodeEventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import "./vscode-loader.cjs";
import { before, describe, it } from "node:test";
import type { ChildProcess } from "node:child_process";
import type { CancellationToken } from "vscode";

let collectProcessOutput: typeof import("../process").collectProcessOutput;

before(async () => {
  ({ collectProcessOutput } = await import("../process"));
});

function createChild() {
  const emitter = new NodeEventEmitter();
  const child = Object.assign(emitter, {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => true,
  }) as unknown as ChildProcess;
  return { child, emitter };
}

function createToken() {
  let disposeCalls = 0;
  let retainedListener: (() => void) | undefined;
  const token = {
    isCancellationRequested: false,
    onCancellationRequested(listener: () => void, thisArgs?: unknown, disposables?: { dispose(): unknown }[]) {
      retainedListener = thisArgs ? listener.bind(thisArgs) : listener;
      const disposable = {
        dispose() {
          disposeCalls++;
          retainedListener = undefined;
        },
      };
      disposables?.push(disposable);
      return disposable;
    },
  } as unknown as CancellationToken;
  return { token, disposeCalls: () => disposeCalls, retainedListener: () => retainedListener };
}

describe("collectProcessOutput regressions", () => {
  for (const settlement of ["close", "error"] as const) {
    it(`disposes the cancellation listener after ${settlement}`, async () => {
      const { child, emitter } = createChild();
      const cancellation = createToken();
      const result = collectProcessOutput(child, cancellation.token);

      if (settlement === "close") {
        emitter.emit("close", 0, null);
        await result;
      } else {
        emitter.emit("error", new Error("spawn failed"));
        await assert.rejects(result, /Spawning command failed: spawn failed/);
      }

      assert.equal(cancellation.disposeCalls(), 1);
      assert.equal(cancellation.retainedListener(), undefined);
    });
  }
});
