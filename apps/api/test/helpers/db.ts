import { createPrisma, type PrismaClient } from "../../src/db.js";

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Integration tests need TEST_DATABASE_URL or DATABASE_URL");
  }
  return url;
}

export function createTestPrisma(): PrismaClient {
  return createPrisma(testDatabaseUrl());
}

/** Empties every table. `users` cascades to everything that belongs to a user. */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "users" RESTART IDENTITY CASCADE');
}
