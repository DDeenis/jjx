/* eslint-disable @typescript-eslint/no-floating-promises */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import "./vscode-loader.cjs";

let createPolling: typeof import("../polling").createPolling;
let workspace: typeof import("vscode").workspace;

before(async () => {
  ({ createPolling } = await import("../polling"));
  ({ workspace } = (
    globalThis as typeof globalThis & { __vscodeMock: { workspace: typeof import("vscode").workspace } }
  ).__vscodeMock);
});

describe("createPolling regressions", () => {
  it("does not schedule another probe when polling is disabled and no repositories exist", async () => {
    const subscriptions: { dispose(): unknown }[] = [];
    const state = {
      context: { subscriptions },
      workspaceSCM: {
        repoSCMs: [],
        refresh: () => Promise.resolve(false),
      },
      getSelectedRepo: () => undefined,
      setSelectedRepo: () => {},
      graphWebview: undefined,
    } as unknown as Parameters<typeof createPolling>[0];

    const originalGetConfiguration = workspace.getConfiguration;
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const scheduledDelays: number[] = [];
    workspace.getConfiguration = (() => ({ get: () => 0 })) as unknown as typeof workspace.getConfiguration;
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      scheduledDelays.push(args[1] ?? 0);
      return {} as NodeJS.Timeout;
    }) as typeof setTimeout;
    globalThis.clearTimeout = () => {};

    try {
      const polling = createPolling(state, () => Promise.resolve());
      await polling.scheduleNextPoll();
      assert.deepEqual(scheduledDelays, []);
    } finally {
      subscriptions.forEach((subscription) => subscription.dispose());
      workspace.getConfiguration = originalGetConfiguration;
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});
