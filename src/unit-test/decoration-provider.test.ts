/* eslint-disable @typescript-eslint/no-floating-promises */
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { before, describe, it } from "node:test";
import "./vscode-loader.cjs";
import type { FileStatus } from "../types";

let JJDecorationProvider: typeof import("../decoration-provider").JJDecorationProvider;
let Uri: typeof import("vscode").Uri;

before(async () => {
  ({ JJDecorationProvider } = await import("../decoration-provider"));
  ({ Uri } = (globalThis as typeof globalThis & { __vscodeMock: { Uri: typeof import("vscode").Uri } }).__vscodeMock);
});

type DecorationChange = import("vscode").Uri | import("vscode").Uri[] | undefined;

function createProvider() {
  let registrations = 0;
  const provider = new JJDecorationProvider(() => registrations++);
  return { provider, registrations: () => registrations };
}

function refresh(
  provider: InstanceType<typeof JJDecorationProvider>,
  repositoryRoot: string,
  options: { statuses?: FileStatus[]; tracked?: string[]; conflicts?: string[]; untracked?: FileStatus[] } = {},
) {
  provider.onRefresh(
    repositoryRoot,
    new Map([["@", options.statuses ?? []]]),
    new Set(options.tracked ?? []),
    new Map([["@", new Set(options.conflicts ?? [])]]),
    options.untracked ?? [],
  );
}

describe("JJDecorationProvider regressions", () => {
  it("marks only files inside a reported repository as ignored", () => {
    const { provider } = createProvider();
    const root = resolve("jj-repo");
    refresh(provider, root, { tracked: [join(root, "tracked.txt")] });

    assert.equal(provider.provideFileDecoration(Uri.file(resolve("plain-folder", "file.txt"))), undefined);
    assert.equal(
      (provider.provideFileDecoration(Uri.file(join(root, "ignored.txt")))?.color as { id?: string })?.id,
      "jjDecoration.ignoredResourceForeground",
    );
  });

  it("keeps decoration event arrays within VS Code's limit", () => {
    const { provider } = createProvider();
    const root = resolve("repo");
    const events: DecorationChange[] = [];
    provider.onDidChangeFileDecorations((event) => events.push(event));
    refresh(provider, root);

    const tracked = Array.from({ length: 251 }, (_, index) => join(root, `tracked-${index}.txt`));
    refresh(provider, root, { tracked });

    assert.ok(
      events.every((event) => !Array.isArray(event) || event.length <= 250),
      "decoration event arrays must not exceed 250 URIs",
    );
    if (!events.includes(undefined)) {
      const emittedFiles = new Set(
        events
          .flatMap((event) => (Array.isArray(event) ? event : []))
          .filter((uri) => uri.scheme === "file")
          .map((uri) => uri.fsPath),
      );
      assert.deepEqual(emittedFiles, new Set(tracked));
    }
  });

  it("invalidates ignored decorations when a repository is added", () => {
    const { provider } = createProvider();
    refresh(provider, resolve("repo-a"));
    const events: DecorationChange[] = [];
    provider.onDidChangeFileDecorations((event) => events.push(event));

    refresh(provider, resolve("repo-b"));

    assert.deepEqual(events, [undefined]);
  });

  it("invalidates ignored decorations when a repository is removed", () => {
    const { provider } = createProvider();
    const repoA = resolve("repo-a");
    const repoB = resolve("repo-b");
    refresh(provider, repoA);
    refresh(provider, repoB);
    const events: DecorationChange[] = [];
    provider.onDidChangeFileDecorations((event) => events.push(event));

    provider.removeStaleRepositories([repoA]);

    assert.deepEqual(events, [undefined]);
  });
});
