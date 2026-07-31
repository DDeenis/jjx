import { test as base, expect, mod } from "./base-test";

const test = base.extend({
  customSettings:
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use({
        "explorer.compactFolders": false,
        "jjx.pollIntervalSeconds": 0,
      });
    },
  workspaceFolders: [
    async ({ testRepo }, use) => {
      await testRepo.commitFile("outer/inner/modified.txt", "before", "baseline");
      await testRepo.writeFile("outer/inner/modified.txt", "after");
      await testRepo.writeFile("outer/inner/added.txt", "added");
      await use([testRepo.repoPath]);
    },
    { scope: "test" },
  ],
});

test("propagates initial nested statuses to a collapsed Explorer folder", async ({ workbox }) => {
  await expect(workbox.locator(".monaco-workbench")).toBeVisible();
  await workbox.keyboard.press(`${mod}+Shift+E`);

  const explorer = workbox.getByRole("tree", { name: "Files Explorer" });
  await expect(explorer).toBeVisible();
  const outer = explorer.getByRole("treeitem", { name: /^outer(?:,|$)/ }).first();
  await expect(outer).toBeVisible();
  await expect(outer).toHaveAttribute("aria-expanded", "false");
  await expect(explorer.getByRole("treeitem", { name: /^inner(?:,|$)/ })).toHaveCount(0);
  await expect(explorer.getByRole("treeitem", { name: /modified\.txt/ })).toHaveCount(0);
  await expect(explorer.getByRole("treeitem", { name: /added\.txt/ })).toHaveCount(0);

  await expect
    .poll(() =>
      outer.evaluate((element) =>
        [element, ...element.querySelectorAll("*")].some((candidate) =>
          Array.from(candidate.classList).some((className) => className.startsWith("monaco-decoration-bubbleBadge-")),
        ),
      ),
    )
    .toBe(true);

  await expect(outer).toHaveAttribute("aria-expanded", "false");
});
