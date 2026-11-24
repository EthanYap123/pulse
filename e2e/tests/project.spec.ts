import { expect, test } from "@playwright/test";
import {
  addMonitor,
  createProject,
  HEALTHY_URL,
  monitorRow,
  section,
  signUp,
  tick,
} from "../support/app.ts";

test("refuses private addresses and hostnames that don't exist", async ({ page }) => {
  await signUp(page);
  await createProject(page);
  const form = section(page, "Add a monitor");
  for (const [url, message] of [
    ["http://169.254.169.254/latest/meta-data", "Private, local and internal addresses"],
    ["http://localhost:4100/health", "Private, local and internal addresses"],
    ["https://does-not-exist.example.invalid/", "couldn't find that hostname"],
  ] as const) {
    await form.getByLabel("Name").fill("Bad");
    await form.getByLabel("URL").fill(url);
    await form.getByRole("button", { name: "Add monitor" }).click();
    await expect(form.getByRole("alert")).toContainText(message);
  }
  await expect(page.getByText("No monitors yet.")).toBeVisible();
});

test("pauses, resumes, hides and deletes monitors", async ({ page, browser }) => {
  await signUp(page);
  const slug = await createProject(page, "Docs");
  await addMonitor(page, "Public", HEALTHY_URL);
  const hidden = await addMonitor(page, "Internal", HEALTHY_URL);
  await hidden.getByRole("button", { name: "Hide from page" }).click();
  await expect(hidden.getByRole("button", { name: "Show on page" })).toBeVisible();

  const row = monitorRow(page, "Public");
  await row.getByRole("button", { name: "Pause" }).click();
  await expect(row).toContainText("Paused");
  await expect(row).toContainText("not checked while paused");
  await row.getByRole("button", { name: "Resume" }).click();
  await expect(row).toContainText("Pending");

  await tick();
  const visitor = await browser.newContext();
  const status = await visitor.newPage();
  await status.goto(`/status/${slug}`);
  await expect(status.getByText("Public", { exact: true })).toBeVisible();
  await expect(status.getByText("Internal", { exact: true })).toHaveCount(0);
  await visitor.close();

  page.once("dialog", (dialog) => void dialog.accept());
  await hidden.getByRole("button", { name: "Delete" }).click();
  await expect(hidden).toHaveCount(0);
  await expect(row).toBeVisible();
});

test("a private project has no status page", async ({ page }) => {
  await signUp(page);
  const slug = await createProject(page, "Secret");
  await page.getByRole("button", { name: "Make private" }).click();
  await expect(page.getByText("Status page is private")).toBeVisible();
  const res = await page.goto(`/status/${slug}`);
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Status page not found" })).toBeVisible();
});

test("adds, turns off and deletes an alert channel", async ({ page }) => {
  await signUp(page);
  await createProject(page);
  const alerts = section(page, "Alerts");
  await alerts.getByLabel("Name").fill("Team");
  await alerts.getByLabel("Discord webhook URL").fill("https://example.com/not-a-webhook");
  await alerts.getByRole("button", { name: "Add Discord channel" }).click();
  await expect(alerts.getByRole("status")).toContainText("Paste a Discord webhook URL");

  // Right shape, but not a real webhook. Nothing in this test sends to it.
  const webhook = ["https://discord.com/api/webhooks", "1".repeat(18), "x".repeat(30)].join("/");
  await alerts.getByLabel("Discord webhook URL").fill(webhook);
  await alerts.getByRole("button", { name: "Add Discord channel" }).click();
  await expect(alerts.getByRole("status")).toContainText("Channel added.");
  const channel = alerts.getByRole("listitem").filter({ hasText: "Team" });
  // The token never comes back to the browser.
  await expect(channel).toContainText("discord.com/api/webhooks/1111…");
  await expect(page.getByText("x".repeat(30))).toHaveCount(0);

  await channel.getByRole("button", { name: "Turn off" }).click();
  await expect(channel.getByRole("button", { name: "Turn on" })).toBeVisible();
  await expect(channel.getByRole("button", { name: "Send test" })).toHaveCount(0);

  page.once("dialog", (dialog) => void dialog.accept());
  await channel.getByRole("button", { name: "Delete" }).click();
  await expect(channel).toHaveCount(0);
});

test("enforces the project limit and frees a slot on delete", async ({ page }) => {
  await signUp(page);
  for (const name of ["One", "Two", "Three"]) {
    await createProject(page, name);
    await page.getByRole("link", { name: "← Projects" }).click();
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  }
  await expect(page.getByText("3 of 3 projects")).toBeVisible();
  await expect(page.getByText("You’ve reached the free limit of 3 projects.")).toBeVisible();

  await page.getByRole("link", { name: "Two" }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete project" }).click();
  await expect(page.getByText("2 of 3 projects")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create project" })).toBeVisible();
});
