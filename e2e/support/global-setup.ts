import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import pg from "pg";
import { CHECKER_URL, DATABASE_URL } from "./stack.ts";

/** Recreates the E2E database from the migrations, so every run starts empty. */
export default async function globalSetup(): Promise<void> {
  const url = new URL(DATABASE_URL);
  const name = url.pathname.slice(1);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/^\w+_e2e$/.test(name)) {
    throw new Error(
      "E2E_DATABASE_URL must be a local database whose name ends in _e2e: it is dropped on every run",
    );
  }

  // Also proves the checker started with the E2E variables, not a developer's .dev.vars.
  const health = (await (await fetch(`${CHECKER_URL}/health`)).json()) as { environment: string };
  if (health.environment !== "e2e") {
    throw new Error(`The checker is running as "${health.environment}", not e2e`);
  }

  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.href });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }

  const apiDir = path.resolve(import.meta.dirname, "../../apps/api");
  const prisma = createRequire(path.join(apiDir, "package.json")).resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prisma, "migrate", "deploy"], {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL },
    stdio: "inherit",
  });
}
