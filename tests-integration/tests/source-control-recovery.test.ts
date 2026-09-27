import path from "path";
import { createJJTestWrapper, type JJTestWrapper } from "../jj-wrapper";
import { test as base, expect, runCommand } from "./base-test";

type RecoveryFixtures = { jjWrapper: JJTestWrapper };

const test = base.extend<RecoveryFixtures>({
  jjWrapper: async ({ cachePath }, use) => {
    await use(await createJJTestWrapper(cachePath));
  },
  customSettings: async ({ jjWrapper }, use) => {
    await use({
      "jjx.jjPath": jjWrapper.executablePath,
      "jjx.pollIntervalSeconds": 0,
      "scm.alwaysShowRepositories": true,
    });
  },
});

async function waitForFailure(jjWrapper: JJTestWrapper, id: string): Promise<void> {
  await expect(async () => {
    const failures = (await jjWrapper.invocations()).filter((entry) => entry.event === "failure" && entry.id === id);
    expect(failures).toHaveLength(1);
  }).toPass();
}

function containsArgs(args: string[], sequence: string[]): boolean {
  return args.some((_, start) => sequence.every((value, offset) => args[start + offset] === value));
}

test("retries a failed state refresh for the same operation", async ({ graphFrame, jjWrapper, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "a", "A");
  await expect(graphFrame.getByText("A", { exact: true })).toBeVisible();

  await jjWrapper.armFailure({
    id: "status-refresh",
    cwd: testRepo.repoPath,
    args: ["file", "list"],
    stderr: "injected file list failure",
  });
  await testRepo.commitFile("b.txt", "b", "B");
  await waitForFailure(jjWrapper, "status-refresh");

  await runCommand(workbox, "Jujutsu: Refresh");

  await expect(graphFrame.getByText("B", { exact: true })).toBeVisible();
});

test("keeps a known repository after a transient discovery failure", async ({
  graphFrame,
  jjWrapper,
  scmView,
  testRepo,
  workbox,
}) => {
  await testRepo.commitFile("a.txt", "a", "A");
  await expect(graphFrame.getByText("A", { exact: true })).toBeVisible();
  const scmTree = scmView.getByRole("tree", { name: "Source Control Management" });
  const repositoryName = path.basename(testRepo.repoPath);
  await expect(scmTree.locator('[role="treeitem"][aria-level="1"]').filter({ hasText: repositoryName })).toHaveCount(1);

  await jjWrapper.armFailure({
    id: "repository-discovery",
    cwd: testRepo.repoPath,
    args: ["--ignore-working-copy", "root"],
    stderr: "injected transient discovery failure",
  });
  await runCommand(workbox, "Jujutsu: Refresh");
  await waitForFailure(jjWrapper, "repository-discovery");

  const repositoryItem = scmTree.locator('[role="treeitem"][aria-level="1"]').filter({ hasText: repositoryName });
  await expect(async () => {
    const invocations = await jjWrapper.invocations();
    const failureIndex = invocations.findIndex(
      (entry) => entry.event === "failure" && entry.id === "repository-discovery",
    );
    const refreshContinued = invocations
      .slice(failureIndex + 1)
      .some((entry) => containsArgs(entry.args, ["operation", "log"]));
    if ((await repositoryItem.count()) === 1 && !refreshContinued) {
      throw new Error("Refresh has not finished processing the discovery failure");
    }
  }).toPass();

  await expect(repositoryItem).toHaveCount(1);
  await expect(scmTree.getByRole("treeitem", { name: /no jj repository found/i })).toHaveCount(0);
});
