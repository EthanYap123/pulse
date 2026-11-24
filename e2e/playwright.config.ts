import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { API_URL, apiEnv, CHECKER_URL, PORTS, WEB_URL, webEnv } from "./support/stack.ts";

const apps = path.resolve(import.meta.dirname, "../apps");
const ci = Boolean(process.env.CI);
const next = "node node_modules/next/dist/bin/next";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./support/global-setup.ts",
  // One worker: a checker tick checks every monitor, so tests that trigger ticks share it.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [["github"], ["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: WEB_URL,
    // A fixed zone and locale keep dates the same on every machine.
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // The production builds, not dev servers. `pnpm test:e2e` builds shared and the API first.
  webServer: [
    {
      name: "api",
      command: "node dist/server.js",
      cwd: path.join(apps, "api"),
      env: apiEnv,
      url: `${API_URL}/health`,
      reuseExistingServer: false,
    },
    {
      name: "checker",
      command: "node --experimental-strip-types support/start-checker.ts",
      url: `${CHECKER_URL}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      name: "web",
      command: `${next} build && ${next} start --port ${PORTS.web}`,
      cwd: path.join(apps, "web"),
      env: webEnv,
      url: WEB_URL,
      timeout: 240_000,
      reuseExistingServer: false,
    },
  ],
});
