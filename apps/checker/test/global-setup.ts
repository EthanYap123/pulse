import { execSync } from "node:child_process";
import "./load-env.js";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { checkerTestDatabaseUrl } from "./database-url.js";

/** Creates the checker's test database if needed and applies the API's migrations to it. */
export default async function setup(): Promise<void> {
  const target = new URL(checkerTestDatabaseUrl());
  const name = target.pathname.slice(1);
  const server = new URL(target);
  server.pathname = "/postgres";

  const admin = new pg.Client({ connectionString: server.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${name.replace(/"/g, "")}"`);
  } finally {
    await admin.end();
  }

  execSync("pnpm exec prisma migrate deploy", {
    cwd: fileURLToPath(new URL("../../api", import.meta.url)),
    env: { ...process.env, DATABASE_URL: target.toString() },
    stdio: "inherit",
  });
}
