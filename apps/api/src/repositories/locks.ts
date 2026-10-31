import type { Prisma } from "../generated/prisma/client.js";

/**
 * Serialises cap checks for one user: concurrent creates wait here, so two requests can't
 * both see "2 of 3 projects" and both insert.
 */
export async function lockUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT 1 FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE`;
}

/** Serialises changes to the number of active monitors, which has a global cap. */
export async function lockActiveMonitorCount(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pulse:active-monitors'))`;
}
