import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, { message: "JWT_SECRET must be at least 32 characters" }),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_VERSION: z.string().default("dev"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Path the browser sees for auth routes (through the Next.js /api rewrite). */
  COOKIE_PATH: z.string().default("/api/v1/auth"),
});

export type Config = {
  databaseUrl: string;
  jwtSecret: string;
  port: number;
  version: string;
  cookie: { path: string; secure: boolean };
};

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  const e = parsed.data;
  return {
    databaseUrl: e.DATABASE_URL,
    jwtSecret: e.JWT_SECRET,
    port: e.PORT,
    version: e.APP_VERSION,
    // Secure cookies need HTTPS outside localhost; local dev runs on plain http.
    cookie: { path: e.COOKIE_PATH, secure: e.NODE_ENV === "production" },
  };
}
