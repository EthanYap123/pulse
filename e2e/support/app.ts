import { randomUUID } from "node:crypto";
import { expect, type Locator, type Page } from "@playwright/test";
import { CHECKER_URL } from "./stack.ts";

/**
 * Real sites, because private addresses are refused by design (ARCHITECTURE.md 3.7).
 * example.com is reserved for documentation and answers 404 for any other path.
 */
export const HEALTHY_URL = "https://example.com/";
export const FAILING_URL = "https://example.com/pulse-e2e-missing";

export const PASSWORD = "e2e test password 123";

export const uniqueEmail = () => `e2e-${randomUUID()}@example.com`;
export const uniqueSlug = () => `e2e-${randomUUID().slice(0, 12)}`;

export async function signUp(page: Page): Promise<string> {
  const email = uniqueEmail();
  // The project page prefetches its status page, which caches it before the first check. A
  // stale copy can then outlive its 60 s, so without this a visitor would see the old page.
  await page.route("**/status/**", (route) =>
    route.request().resourceType() === "fetch" ? route.abort() : route.continue(),
  );
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  return email;
}

/** From the dashboard: creates a project and opens it. Returns its status page address. */
export async function createProject(page: Page, name = "My app"): Promise<string> {
  const slug = uniqueSlug();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Status page address").fill(slug);
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("link", { name: `/status/${slug}` }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return slug;
}

/** From a project page. Returns the new monitor's row. */
export async function addMonitor(page: Page, name: string, url: string): Promise<Locator> {
  const form = section(page, "Add a monitor");
  await form.getByLabel("Name").fill(name);
  await form.getByLabel("URL").fill(url);
  await form.getByRole("button", { name: "Add monitor" }).click();
  const row = monitorRow(page, name);
  await expect(row).toBeVisible();
  return row;
}

export const monitorRow = (page: Page, name: string): Locator =>
  page.locator(".monitor-row").filter({ has: page.getByRole("link", { name, exact: true }) });

/** A card on the page, found by its heading. */
export const section = (page: Page, heading: string): Locator =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: heading }) });

async function cron(time: number): Promise<void> {
  const url = new URL("/cdn-cgi/handler/scheduled", CHECKER_URL);
  url.searchParams.set("cron", "*/5 * * * *");
  url.searchParams.set("time", String(time));
  const res = await fetch(url);
  expect(res.ok, `cron trigger: ${res.status} ${await res.clone().text()}`).toBe(true);
}

/** Runs one cron tick: every unpaused monitor is checked once. */
export const tick = (): Promise<void> => cron(Date.now());

/** Runs a minute-0 tick: checks, then the hourly flush, rollups and status page rebuild. */
export const hourlyTick = (): Promise<void> => cron(Math.floor(Date.now() / 3_600_000) * 3_600_000);
