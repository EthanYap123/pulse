import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { checkerVars, PORTS } from "./stack.ts";

// Runs the checker Worker in workerd with empty Durable Objects and only the E2E variables.
// `--env-file` replaces apps/checker/.dev.vars, so a developer's own values are never used.
const e2eDir = path.resolve(import.meta.dirname, "..");
const checkerDir = path.resolve(e2eDir, "../apps/checker");
const stateDir = path.join(e2eDir, ".checker");

rmSync(stateDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
mkdirSync(stateDir, { recursive: true });
const envFile = path.join(stateDir, "checker.env");
writeFileSync(
  envFile,
  Object.entries(checkerVars)
    .map(([key, value]) => `${key}="${value}"\n`)
    .join(""),
);

const checkerRequire = createRequire(path.join(checkerDir, "package.json"));
const wrangler = path.join(
  path.dirname(checkerRequire.resolve("wrangler/package.json")),
  "bin/wrangler.js",
);

const child = spawn(
  process.execPath,
  [
    wrangler,
    "dev",
    "--test-scheduled",
    "--show-interactive-dev-session=false",
    "--ip=127.0.0.1",
    `--port=${PORTS.checker}`,
    `--inspector-port=${PORTS.inspector}`,
    `--persist-to=${path.join(stateDir, "state")}`,
    `--env-file=${envFile}`,
  ],
  {
    cwd: checkerDir,
    stdio: "inherit",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  },
);
child.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
