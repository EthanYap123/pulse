import { buildApp } from "./app.js";
import { createPrisma } from "./db.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

const prisma = createPrisma(databaseUrl);
const app = buildApp({
  prisma,
  version: process.env.APP_VERSION ?? "dev",
  logger: true,
});

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 4000) });
