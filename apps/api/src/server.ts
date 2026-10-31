import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPrisma } from "./db.js";

const config = loadConfig(process.env);
const prisma = createPrisma(config.databaseUrl);
const app = buildApp({ prisma, config, logger: true });

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

await app.listen({ host: "0.0.0.0", port: config.port });
