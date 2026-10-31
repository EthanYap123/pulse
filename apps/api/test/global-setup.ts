import { execSync } from "node:child_process";
import "dotenv/config";

/** Applies all migrations to the test database once, before any integration test runs. */
export default function setup(): void {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Integration tests need TEST_DATABASE_URL or DATABASE_URL (see apps/api/.env.example)",
    );
  }
  execSync("prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
}
