import { randomUUID } from "node:crypto";
import type { TokenHash } from "../auth/tokens.js";
import type { PrismaClient } from "../generated/prisma/client.js";

export type RotateResult =
  | { kind: "rotated"; userId: string }
  | { kind: "reused" }
  | { kind: "expired" }
  | { kind: "unknown" };

export function refreshTokensRepository(prisma: PrismaClient) {
  async function revokeFamily(familyId: string, now: Date): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  return {
    /** Starts a new token family (a new sign-in). */
    async issue(userId: string, hash: TokenHash, expiresAt: Date): Promise<void> {
      await prisma.refreshToken.create({
        data: { userId, familyId: randomUUID(), tokenHash: hash, expiresAt },
      });
    },

    /**
     * Swaps an old token for a new one in the same family. A token that was already
     * rotated has leaked or been replayed, so presenting it revokes the whole family.
     */
    async rotate(
      oldHash: TokenHash,
      newHash: TokenHash,
      expiresAt: Date,
      now = new Date(),
    ): Promise<RotateResult> {
      const current = await prisma.refreshToken.findUnique({ where: { tokenHash: oldHash } });
      if (!current) return { kind: "unknown" };
      if (current.revokedAt) {
        await revokeFamily(current.familyId, now);
        return { kind: "reused" };
      }
      if (current.expiresAt <= now) return { kind: "expired" };

      const rotated = await prisma.$transaction(async (tx) => {
        // Conditional update: if a concurrent request already rotated this token, nothing
        // matches and no second valid token is handed out.
        const { count } = await tx.refreshToken.updateMany({
          where: { id: current.id, revokedAt: null },
          data: { revokedAt: now },
        });
        if (count === 0) return false;
        const replacement = await tx.refreshToken.create({
          data: {
            userId: current.userId,
            familyId: current.familyId,
            tokenHash: newHash,
            expiresAt,
          },
        });
        await tx.refreshToken.update({
          where: { id: current.id },
          data: { replacedBy: replacement.id },
        });
        return true;
      });

      if (!rotated) {
        await revokeFamily(current.familyId, now);
        return { kind: "reused" };
      }
      return { kind: "rotated", userId: current.userId };
    },

    /** Signs out: revokes every token in the presented token's family. */
    async revokeByHash(hash: TokenHash, now = new Date()): Promise<void> {
      const token = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
      if (token) await revokeFamily(token.familyId, now);
    },
  };
}
