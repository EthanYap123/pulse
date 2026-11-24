import { expect, test } from "@playwright/test";
import {
  addMonitor,
  createProject,
  FAILING_URL,
  HEALTHY_URL,
  hourlyTick,
  monitorRow,
  section,
  signUp,
  tick,
} from "../support/app.ts";

// PRD success metric: from sign-up to a live status page.
test("a new user goes from sign-up to a live status page", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page).toHaveURL("/signup");
  const email = await signUp(page);
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText("No projects yet.")).toBeVisible();
  await expect(page.getByText("0 of 3 projects")).toBeVisible();

  const slug = await createProject(page, "Acme");
  const row = await addMonitor(page, "Homepage", HEALTHY_URL);
  await expect(row).toContainText("Pending");

  await tick();
  await page.reload();
  await expect(monitorRow(page, "Homepage")).toContainText("Up");
  await expect(monitorRow(page, "Homepage")).toContainText("checked just now");

  // A visitor with no session sees it too.
  const visitor = await browser.newContext();
  const status = await visitor.newPage();
  await status.goto(`/status/${slug}`);
  await expect(status).toHaveTitle(/Acme status/);
  await expect(status.getByRole("heading", { level: 1, name: "Acme" })).toBeVisible();
  await expect(status.getByRole("status")).toContainText("All systems operational");
  const item = status.getByRole("listitem").filter({ hasText: "Homepage" });
  await expect(item.locator(".badge")).toContainText("Up");
  await expect(status.getByText("No incidents.")).toBeVisible();
  await visitor.close();
});

test("the monitor page charts checks after the hourly flush", async ({ page }) => {
  await signUp(page);
  await createProject(page);
  await addMonitor(page, "Homepage", HEALTHY_URL);
  await page.getByRole("link", { name: "Homepage", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Homepage" })).toBeVisible();
  await expect(page.getByText("No checks yet for this range.")).toBeVisible();

  await tick();
  await hourlyTick();
  await page.reload();
  await expect(page.getByRole("img", { name: "Response time over the last 24h" })).toBeVisible();
  await expect(page.locator(".stats")).toContainText("100%");

  // The other ranges read hourly rollups. Those only cover complete hours, so whether there are
  // points yet depends on the clock: check that they load, not what they show.
  const ranges = page.getByRole("group", { name: "Time range" });
  for (const name of ["7 days", "30 days"]) {
    await ranges.getByRole("button", { name }).click();
    await expect(ranges.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByText("No checks yet for this range.").or(page.locator(".chart")),
    ).toBeVisible();
  }

  await page.getByRole("link", { name: "← Monitors" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "My app" })).toBeVisible();
});

test("an outage opens an incident, shows publicly, and ends when paused", async ({
  page,
  browser,
}) => {
  await signUp(page);
  const slug = await createProject(page, "Shop");
  await addMonitor(page, "Checkout", FAILING_URL);

  await tick();
  await page.reload();
  await expect(monitorRow(page, "Checkout")).toContainText("Failing");
  await expect(section(page, "Incidents")).toContainText("No incidents.");

  // Down after 3 failures in a row (the default threshold).
  await tick();
  await tick();
  await page.reload();
  await expect(monitorRow(page, "Checkout")).toContainText("Down");
  const incidents = section(page, "Incidents");
  await expect(incidents).toContainText("Ongoing");
  await expect(incidents).toContainText("Unexpected status code (HTTP 404)");

  page.once("dialog", (dialog) => void dialog.accept("Investigating the checkout"));
  await incidents.getByRole("button", { name: "Add note" }).click();
  await expect(incidents).toContainText("Investigating the checkout");

  const visitor = await browser.newContext();
  const status = await visitor.newPage();
  await status.goto(`/status/${slug}`);
  await expect(status.getByRole("status")).toContainText("Outage in progress");
  await expect(status.locator(".incident")).toContainText("Ongoing");
  await expect(status.locator(".incident")).toContainText("Checkout");
  await visitor.close();

  await monitorRow(page, "Checkout").getByRole("button", { name: "Pause" }).click();
  await expect(monitorRow(page, "Checkout")).toContainText("Paused");
  await expect(incidents).toContainText("Resolved");
  await expect(incidents).toContainText("ended because the monitor was paused");
});
