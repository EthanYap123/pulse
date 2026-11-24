import { expect, test } from "@playwright/test";
import { createProject, PASSWORD, signUp, uniqueEmail } from "../support/app.ts";

test("signing out ends the session and signing in starts a new one", async ({ page }) => {
  const email = await signUp(page);

  // The access token is only in memory, so a reload depends on the refresh cookie.
  await page.reload();
  await expect(page.getByText(email)).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/(login)?$/);
  await expect(page.getByText(email)).toHaveCount(0);
  await page.goto("/dashboard");
  await expect(page).toHaveURL("/login");

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("not the right password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".error")).toBeVisible();
  await expect(page).toHaveURL("/login");

  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/dashboard");
  await expect(page.getByText(email)).toBeVisible();
});

test("sign-up refuses a short password and an email that's taken", async ({ page, browser }) => {
  const email = await signUp(page);

  const other = await browser.newContext();
  const form = await other.newPage();
  await form.goto("/signup");
  await form.getByLabel("Email").fill(uniqueEmail());
  await form.getByLabel("Password").fill("short");
  await form.getByRole("button", { name: "Create account" }).click();
  // The browser's own validation stops the form from being sent.
  await expect(form.locator("input[name=password]:invalid")).toBeVisible();
  await expect(form).toHaveURL("/signup");

  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Password").fill(PASSWORD);
  await form.getByRole("button", { name: "Create account" }).click();
  await expect(form.locator(".error")).toBeVisible();
  await expect(form).toHaveURL("/signup");
  await other.close();
});

test("one user can't open another user's project", async ({ page, browser }) => {
  await signUp(page);
  await createProject(page, "Private work");
  const projectUrl = page.url();

  const other = await browser.newContext();
  const stranger = await other.newPage();
  await signUp(stranger);
  await stranger.goto(projectUrl);
  await expect(stranger.getByRole("heading", { name: "Project not found" })).toBeVisible();
  await expect(stranger.getByText("Private work")).toHaveCount(0);
  await other.close();
});

test("the theme choice survives a reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByLabel("Theme", { exact: true })).toHaveValue("dark");
});
