import fs from "fs";
import os from "os";
import path from "path";
import type { Locator, Page } from "@playwright/test";
import { createJJTestWrapper, type JJTestWrapper, type JJWrapperInvocation } from "../jj-wrapper";
import { test as base, expect, mod, type TestRepo, newTestRepo } from "./base-test";

// Opens a multi-root workspace with two independent jj repositories so that
// repository selection across the graph view, operation log view, and SCM view
// can be exercised.
const test = base.extend<{ repoA: TestRepo; repoB: TestRepo; jjWrapper: JJTestWrapper }>({
  repoA: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "jjx-multiroot-a-"));
      const repo = await newTestRepo(path.join(tempDir, "repo-alpha"));
      await use(repo);
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    },
    { scope: "test" },
  ],
  repoB: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "jjx-multiroot-b-"));
      const repo = await newTestRepo(path.join(tempDir, "repo-beta"));
      await use(repo);
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    },
    { scope: "test" },
  ],
  jjWrapper: async ({ cachePath }, use) => {
    await use(await createJJTestWrapper(cachePath));
  },
  customSettings: async ({ jjWrapper }, use) => {
    await use({
      "jjx.jjPath": jjWrapper.executablePath,
      "jjx.pollIntervalSeconds": 0,
    });
  },
  workspaceFolders: [
    async ({ repoA, repoB }, use) => {
      await use([repoA.repoPath, repoB.repoPath]);
    },
    { scope: "test" },
  ],
});

const discoveryTest = test.extend({
  customSettings: async ({ jjWrapper }, use) => {
    await jjWrapper.configureBarrier({
      id: "parallel-discovery",
      args: ["--ignore-working-copy", "root"],
      expected: 2,
      timeoutMs: 10000,
    });
    await use({
      "jjx.commandTimeout": 15000,
      "jjx.jjPath": jjWrapper.executablePath,
      "jjx.pollIntervalSeconds": 0,
    });
  },
});

function graphPaneHeader(scmView: Locator): Locator {
  return scmView.locator(".pane-header", { hasText: "JJ Graph" }).first();
}

function opLogPaneHeader(scmView: Locator): Locator {
  return scmView.locator(".pane-header", { hasText: "Operation Log" }).first();
}

async function openRepoPicker(workbox: Page, paneHeader: Locator): Promise<Locator> {
  await paneHeader.getByRole("button", { name: "Select Repository" }).click();
  const quickInput = workbox.locator(".quick-input-widget");
  await expect(quickInput).toBeVisible();
  return quickInput;
}

function isInvocationForRepo(invocation: JJWrapperInvocation, repoPath: string): boolean {
  const normalize = (value: string) => path.resolve(value).toLowerCase();
  return invocation.event === "invoke" && normalize(invocation.cwd) === normalize(repoPath);
}

function containsArgs(args: string[], sequence: string[]): boolean {
  return args.some((_, start) => sequence.every((value, offset) => args[start + offset] === value));
}

async function openFileViaQuickOpen(workbox: Page, fileName: string): Promise<Locator> {
  await workbox.keyboard.press(`${mod}+p`);
  const quickOpen = workbox.locator(".quick-input-widget");
  await expect(quickOpen).toBeVisible();
  await workbox.keyboard.type(fileName);
  const result = quickOpen.locator(".monaco-list-row").first();
  await expect(result).toBeVisible();
  await result.click();

  const editor = workbox.locator(`.monaco-editor[role="code"][data-uri*="${fileName}"]`);
  await expect(editor).toBeVisible();
  return editor;
}

test("multi-root workspace exposes both repos and follows the active editor's repository", async ({
  workbox,
  scmView,
  graphFrame,
  opLog,
  repoA,
  repoB,
}) => {
  await repoA.commitFile("alpha.txt", "alpha", "alpha commit one");
  await repoB.commitFile("beta.txt", "beta", "beta commit one");

  // The graph and operation log share a single selected repository, so the
  // default state is verified before any switches and each switch trigger is
  // then exercised in turn (graph picker A->B, op-log picker B->A, active
  // editor A->B->A).

  await test.step("initial selection defaults to the first workspace folder", async () => {
    await expect(graphFrame.getByText("alpha commit one")).toBeVisible();
    await expect(graphPaneHeader(scmView).locator("h3.title")).toHaveText(/repo-alpha/);
    await expect(opLogPaneHeader(scmView).locator("h3.title")).toHaveText(/repo-alpha/);
  });

  await test.step("graph view repo picker lists and switches repositories", async () => {
    const graphPicker = await openRepoPicker(workbox, graphPaneHeader(scmView));
    await expect(graphPicker.locator("input").first()).toHaveAttribute("placeholder", "Select a Repository");
    await expect(graphPicker.getByRole("option")).toHaveCount(2);
    await expect(graphPicker.getByRole("option", { name: /repo-alpha/ })).toBeVisible();
    await expect(graphPicker.getByRole("option", { name: /repo-beta/ })).toBeVisible();

    // Switching the selected repo via the graph picker refreshes the graph.
    await graphPicker.getByRole("option", { name: /repo-beta/ }).click();
    await expect(graphFrame.getByText("beta commit one")).toBeVisible();
    await expect(graphFrame.getByText("alpha commit one")).toHaveCount(0);
    await expect(graphPaneHeader(scmView).locator("h3.title")).toHaveText(/repo-beta/);
  });

  await test.step("operation log view repo picker lists and switches repositories", async () => {
    const opLogPicker = await openRepoPicker(workbox, opLogPaneHeader(scmView));
    await expect(opLogPicker.locator("input").first()).toHaveAttribute("placeholder", "Select a Repository");
    await expect(opLogPicker.getByRole("option")).toHaveCount(2);
    await expect(opLogPicker.getByRole("option", { name: /repo-alpha/ })).toBeVisible();
    await expect(opLogPicker.getByRole("option", { name: /repo-beta/ })).toBeVisible();
    await opLogPicker.getByRole("option", { name: /repo-alpha/ }).click();

    // The operation log refreshes to show the other repository's history.
    await expect(opLogPaneHeader(scmView).locator("h3.title")).toHaveText(/repo-alpha/);
    await expect(opLog.locator('[role="treeitem"]').filter({ hasText: "alpha commit one" }).first()).toBeVisible();
    await expect(opLog.locator('[role="treeitem"]').filter({ hasText: "beta commit one" })).toHaveCount(0);
  });

  await test.step("source control view registers both repos independently", async () => {
    const scmTree = scmView.getByRole("tree", { name: "Source Control Management" });
    const repoItems = scmTree.locator('[role="treeitem"][aria-level="1"]');
    await expect(repoItems).toHaveCount(2);
    await expect(repoItems.filter({ hasText: "repo-alpha" })).toHaveAttribute("aria-label", /repo-alpha Jujutsu/);
    await expect(repoItems.filter({ hasText: "repo-beta" })).toHaveAttribute("aria-label", /repo-beta Jujutsu/);

    // Each repository tracks its own independent working copy state.
    await expect(
      scmTree.locator('[role="treeitem"][aria-level="2"]').filter({ hasText: "alpha commit one" }),
    ).toBeVisible();
    await expect(
      scmTree.locator('[role="treeitem"][aria-level="2"]').filter({ hasText: "beta commit one" }),
    ).toBeVisible();
  });

  await test.step("graph and operation log follow the active editor's repository", async () => {
    // Opening a file from repo-beta switches the selected repository.
    await openFileViaQuickOpen(workbox, "beta.txt");
    await expect(graphPaneHeader(scmView).locator("h3.title")).toHaveText(/repo-beta/);
    await expect(opLogPaneHeader(scmView).locator("h3.title")).toHaveText(/repo-beta/);
    await expect(graphFrame.getByText("beta commit one")).toBeVisible();
    await expect(graphFrame.getByText("alpha commit one")).toHaveCount(0);
    await expect(opLog.locator('[role="treeitem"]').filter({ hasText: "beta commit one" }).first()).toBeVisible();

    // Opening a file from repo-alpha switches it back.
    await openFileViaQuickOpen(workbox, "alpha.txt");
    await expect(graphPaneHeader(scmView).locator("h3.title")).toHaveText(/repo-alpha/);
    await expect(opLogPaneHeader(scmView).locator("h3.title")).toHaveText(/repo-alpha/);
    await expect(graphFrame.getByText("alpha commit one")).toBeVisible();
    await expect(graphFrame.getByText("beta commit one")).toHaveCount(0);
  });
});

test("does not refresh other repositories for an unrelated file event", async ({
  jjWrapper,
  repoA,
  repoB,
  scmView,
}) => {
  const scmTree = scmView.getByRole("tree", { name: "Source Control Management" });
  await expect(scmTree.locator('[role="treeitem"][aria-level="1"]')).toHaveCount(2);
  await expect(async () => {
    const invocations = await jjWrapper.invocations();
    for (const repo of [repoA, repoB]) {
      expect(
        invocations.some(
          (entry) => isInvocationForRepo(entry, repo.repoPath) && containsArgs(entry.args, ["file", "list"]),
        ),
      ).toBe(true);
    }
  }).toPass();

  const baseline = await jjWrapper.invocations();
  const repoBBaseline = baseline.filter(
    (entry) => isInvocationForRepo(entry, repoB.repoPath) && containsArgs(entry.args, ["operation", "log"]),
  ).length;

  await repoA.writeFile("watcher-only.txt", "changed");
  await expect(scmTree.getByRole("treeitem", { name: /watcher-only\.txt/ })).toBeVisible();

  const after = await jjWrapper.invocations();
  expect(
    after.filter(
      (entry) => isInvocationForRepo(entry, repoB.repoPath) && containsArgs(entry.args, ["operation", "log"]),
    ),
  ).toHaveLength(repoBBaseline);
});

discoveryTest("starts workspace-folder repository probes concurrently", async ({ jjWrapper, workbox }) => {
  await expect(workbox.locator(".monaco-workbench")).toBeVisible();
  await expect(async () => {
    const completions = (await jjWrapper.invocations()).filter(
      (entry) => entry.event === "barrier-complete" && entry.id === "parallel-discovery",
    );
    expect(completions).toHaveLength(2);
  }).toPass();

  const completions = (await jjWrapper.invocations()).filter(
    (entry) => entry.event === "barrier-complete" && entry.id === "parallel-discovery",
  );
  expect(completions.every((entry) => entry.timedOut === false)).toBe(true);
});

test("does not refresh other repositories for an unrelated file event", async ({
  jjWrapper,
  repoA,
  repoB,
  scmView,
}) => {
  const scmTree = scmView.getByRole("tree", { name: "Source Control Management" });
  await expect(scmTree.locator('[role="treeitem"][aria-level="1"]')).toHaveCount(2);
  await expect(async () => {
    const invocations = await jjWrapper.invocations();
    for (const repo of [repoA, repoB]) {
      expect(
        invocations.some(
          (entry) => isInvocationForRepo(entry, repo.repoPath) && containsArgs(entry.args, ["file", "list"]),
        ),
      ).toBe(true);
    }
  }).toPass();

  const baseline = await jjWrapper.invocations();
  const repoBBaseline = baseline.filter(
    (entry) => isInvocationForRepo(entry, repoB.repoPath) && containsArgs(entry.args, ["operation", "log"]),
  ).length;

  await repoA.writeFile("watcher-only.txt", "changed");
  await expect(scmTree.getByRole("treeitem", { name: /watcher-only\.txt/ })).toBeVisible();

  const after = await jjWrapper.invocations();
  expect(
    after.filter(
      (entry) => isInvocationForRepo(entry, repoB.repoPath) && containsArgs(entry.args, ["operation", "log"]),
    ),
  ).toHaveLength(repoBBaseline);
});

discoveryTest("starts workspace-folder repository probes concurrently", async ({ jjWrapper, workbox }) => {
  await expect(workbox.locator(".monaco-workbench")).toBeVisible();
  await expect(async () => {
    const completions = (await jjWrapper.invocations()).filter(
      (entry) => entry.event === "barrier-complete" && entry.id === "parallel-discovery",
    );
    expect(completions).toHaveLength(2);
  }).toPass();

  const completions = (await jjWrapper.invocations()).filter(
    (entry) => entry.event === "barrier-complete" && entry.id === "parallel-discovery",
  );
  expect(completions.every((entry) => entry.timedOut === false)).toBe(true);
});
