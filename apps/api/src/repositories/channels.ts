import { LIMITS, type ChannelInput, type ChannelPatch } from "@pulse/shared";
import type { Cipher } from "../crypto.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { lockUser } from "./locks.js";

const withProjectName = { project: { select: { name: true } } } as const;

export type ChannelRow = Prisma.AlertChannelGetPayload<{ include: typeof withProjectName }>;

export type CreateChannelResult =
  { kind: "created"; id: string } | { kind: "not_found" } | { kind: "limit_reached" };

/** Every query is scoped to the owner through the project (ADR-0003). */
export function channelsRepository(prisma: PrismaClient, cipher: Cipher) {
  const owned = (ownerId: string, id: string) => ({ id, project: { ownerId } });

  return {
    /** Null when the project doesn't exist or isn't the owner's. */
    async listByProject(ownerId: string, projectId: string): Promise<ChannelRow[] | null> {
      const project = await prisma.project.findFirst({
        where: { id: projectId, ownerId },
        select: { id: true },
      });
      if (!project) return null;
      return prisma.alertChannel.findMany({
        where: { projectId },
        include: withProjectName,
        orderBy: { createdAt: "asc" },
      });
    },

    get(ownerId: string, id: string): Promise<ChannelRow | null> {
      return prisma.alertChannel.findFirst({ where: owned(ownerId, id), include: withProjectName });
    },

    create(ownerId: string, projectId: string, input: ChannelInput): Promise<CreateChannelResult> {
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, ownerId);
        const project = await tx.project.findFirst({ where: { id: projectId, ownerId } });
        if (!project) return { kind: "not_found" } as const;
        const count = await tx.alertChannel.count({ where: { projectId } });
        if (count >= LIMITS.channelsPerProject) return { kind: "limit_reached" } as const;
        const channel = await tx.alertChannel.create({
          data: {
            projectId,
            type: input.type,
            name: input.name,
            cooldownMinutes: input.cooldownMinutes,
            secretEnc: cipher.encrypt(input.webhookUrl),
          },
        });
        return { kind: "created", id: channel.id } as const;
      });
    },

    async update(ownerId: string, id: string, patch: ChannelPatch): Promise<boolean> {
      const data: Prisma.AlertChannelUpdateManyMutationInput = {
        name: patch.name,
        cooldownMinutes: patch.cooldownMinutes,
      };
      if (patch.webhookUrl) {
        data.secretEnc = cipher.encrypt(patch.webhookUrl);
        // A new webhook replaces one Discord rejected, so the channel can be used again.
        if (patch.enabled !== false) Object.assign(data, { state: "active", disabledReason: null });
      }
      if (patch.enabled === true) Object.assign(data, { state: "active", disabledReason: null });
      if (patch.enabled === false)
        Object.assign(data, { state: "disabled", disabledReason: "turned_off" });
      const { count } = await prisma.alertChannel.updateMany({ where: owned(ownerId, id), data });
      return count > 0;
    },

    async delete(ownerId: string, id: string): Promise<boolean> {
      const { count } = await prisma.alertChannel.deleteMany({ where: owned(ownerId, id) });
      return count > 0;
    },

    /** Called when Discord says the webhook no longer works. */
    async disable(id: string, reason: string): Promise<void> {
      await prisma.alertChannel.update({
        where: { id },
        data: { state: "disabled", disabledReason: reason },
      });
    },

    decryptSecret(channel: ChannelRow): string | null {
      return channel.secretEnc ? cipher.decrypt(channel.secretEnc) : null;
    },
  };
}
