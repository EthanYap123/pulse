/**
 * The checker's integration tests use their own database, `<test db>_checker`, so they can
 * run at the same time as the API's integration tests without truncating each other's data.
 */
export function checkerTestDatabaseUrl(): string {
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!base) throw new Error("Integration tests need TEST_DATABASE_URL or DATABASE_URL");
  const url = new URL(base);
  url.pathname = `${url.pathname}_checker`;
  return url.toString();
}
