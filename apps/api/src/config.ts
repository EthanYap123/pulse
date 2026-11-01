import { z } from "zod";

/** `KEY=` in an env file means "not set". */
const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, { message: "JWT_SECRET must be at least 32 characters" }),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, { message: "ENCRYPTION_KEY must be 64 hex characters (32 bytes)" }),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_VERSION: z.string().default("dev"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Path the browser sees for auth routes (through the Next.js /api rewrite). */
  COOKIE_PATH: z.string().default("/api/v1/auth"),
  /** Checker Worker base URL and the secret shared with it. Without them, sync is off. */
  CHECKER_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  CHECKER_HMAC_SECRET: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
});

export type Config = {
  databaseUrl: string;
  jwtSecret: string;
  encryptionKey: string;
  port: number;
  version: string;
  cookie: { path: string; secure: boolean };
  checker: { url: string; secret: string } | null;
};

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  const e = parsed.data;
  if (Boolean(e.CHECKER_URL) !== Boolean(e.CHECKER_HMAC_SECRET)) {
    throw new Error(
      "Invalid environment:\n  Set both CHECKER_URL and CHECKER_HMAC_SECRET, or neither",
    );
  }
  return {
    databaseUrl: e.DATABASE_URL,
    jwtSecret: e.JWT_SECRET,
    encryptionKey: e.ENCRYPTION_KEY,
    port: e.PORT,
    version: e.APP_VERSION,
    // Secure cookies need HTTPS outside localhost; local dev runs on plain http.
    cookie: { path: e.COOKIE_PATH, secure: e.NODE_ENV === "production" },
    checker:
      e.CHECKER_URL && e.CHECKER_HMAC_SECRET
        ? { url: e.CHECKER_URL, secret: e.CHECKER_HMAC_SECRET }
        : null,
  };
}
