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

function status(path: string, type: FileStatus["type"] = "M"): FileStatus {
  return { type, path, file: path };
}

function eventUris(events: DecorationChange[]) {
  return events.flatMap((event) => (event === undefined ? [] : Array.isArray(event) ? event : [event]));
}

function normalizeFsPath(path: string) {
  return process.platform === "win32" ? path.toLowerCase() : path;
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

  it("announces decorations on the first repository refresh", () => {
    const root = resolve("repo");
    const file = join(root, "outer", "inner", "modified.txt");
    const events: DecorationChange[] = [];
    let registrations = 0;
    const provider = new JJDecorationProvider((registeredProvider) => {
      registrations++;
      registeredProvider.onDidChangeFileDecorations((event) => events.push(event));
    });

    refresh(provider, root, { statuses: [status(file)], tracked: [file] });

    assert.equal(registrations, 1);
    assert.equal(events.includes(undefined), false);
    const uris = eventUris(events);
    assert.equal(
      uris.some((uri) => uri.scheme === "jj" && normalizeFsPath(uri.fsPath) === normalizeFsPath(file)),
      true,
    );
    assert.equal(
      uris.some((uri) => uri.scheme === "file" && normalizeFsPath(uri.fsPath) === normalizeFsPath(file)),
      true,
    );
  });

  it("keeps complete decoration events within VS Code's limit", () => {
    const { provider } = createProvider();
    const root = resolve("repo");
    const events: DecorationChange[] = [];
    provider.onDidChangeFileDecorations((event) => events.push(event));
    refresh(provider, root);

    const tracked = Array.from({ length: 251 }, (_, index) => join(root, `tracked-${index}.txt`));
    refresh(provider, root, { statuses: tracked.map((file) => status(file)), tracked });

    assert.equal(events.includes(undefined), false);
    assert.ok(
      events.every((event) => !Array.isArray(event) || event.length <= 250),
      "decoration event arrays must not exceed 250 URIs",
    );
    const uris = eventUris(events);
    assert.equal(new Set(uris.map((uri) => uri.toString())).size, uris.length);
    assert.equal(uris.length, tracked.length * 2);
    assert.deepEqual(
      new Set(uris.filter((uri) => uri.scheme === "file").map((uri) => normalizeFsPath(uri.fsPath))),
      new Set(tracked.map(normalizeFsPath)),
    );
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

  it("reseeds active decorations after a repository is added", () => {
    const { provider } = createProvider();
    const repoA = resolve("repo-a");
    const repoB = resolve("repo-b");
    const fileA = join(repoA, "a.txt");
    const fileB = join(repoB, "b.txt");
    refresh(provider, repoA, { statuses: [status(fileA)], tracked: [fileA] });
    const events: DecorationChange[] = [];
    provider.onDidChangeFileDecorations((event) => events.push(event));

    refresh(provider, repoB, { statuses: [status(fileB)], tracked: [fileB] });

    assert.equal(events[0], undefined);
    assert.deepEqual(
      new Set(
        eventUris(events.slice(1))
          .filter((uri) => uri.scheme === "file")
          .map((uri) => normalizeFsPath(uri.fsPath)),
      ),
      new Set([fileA, fileB].map(normalizeFsPath)),
    );
  });

  it("reseeds only surviving decorations after a repository is removed", () => {
    const { provider } = createProvider();
    const repoA = resolve("repo-a");
    const repoB = resolve("repo-b");
    const fileA = join(repoA, "a.txt");
    const fileB = join(repoB, "b.txt");
    refresh(provider, repoA, { statuses: [status(fileA)], tracked: [fileA] });
    refresh(provider, repoB, { statuses: [status(fileB)], tracked: [fileB] });
    const events: DecorationChange[] = [];
    provider.onDidChangeFileDecorations((event) => events.push(event));

    provider.removeStaleRepositories([repoA]);

    assert.equal(events[0], undefined);
    assert.deepEqual(
      new Set(
        eventUris(events.slice(1))
          .filter((uri) => uri.scheme === "file")
          .map((uri) => normalizeFsPath(uri.fsPath)),
      ),
      new Set([normalizeFsPath(fileA)]),
    );
  });

  it("announces a file when its decoration is removed", () => {
    const { provider } = createProvider();
    const root = resolve("repo");
    const file = join(root, "modified.txt");
    refresh(provider, root, { statuses: [status(file)], tracked: [file] });
    const events: DecorationChange[] = [];
    provider.onDidChangeFileDecorations((event) => events.push(event));

    refresh(provider, root, { tracked: [file] });

    assert.equal(
      eventUris(events).some((uri) => uri.scheme === "file" && normalizeFsPath(uri.fsPath) === normalizeFsPath(file)),
      true,
    );
  });
});
