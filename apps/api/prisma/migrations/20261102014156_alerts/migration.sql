-- CreateEnum
CREATE TYPE "channel_type" AS ENUM ('discord', 'telegram');

-- CreateEnum
CREATE TYPE "channel_state" AS ENUM ('pending_link', 'active', 'disabled');

-- CreateEnum
CREATE TYPE "alert_event" AS ENUM ('opened', 'resolved');

-- CreateEnum
CREATE TYPE "delivery_state" AS ENUM ('pending', 'sent', 'suppressed', 'failed');

-- CreateTable
CREATE TABLE "alert_channels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "type" "channel_type" NOT NULL,
    "name" TEXT NOT NULL,
    "secret_enc" TEXT,
    "cooldown_minutes" SMALLINT NOT NULL DEFAULT 10,
    "state" "channel_state" NOT NULL DEFAULT 'active',
    "disabled_reason" TEXT,
    "link_code_hash" TEXT,
    "link_expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "incident_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "event" "alert_event" NOT NULL,
    "state" "delivery_state" NOT NULL DEFAULT 'pending',
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "alert_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "alert_channels_link_code_hash_key" ON "alert_channels"("link_code_hash");

-- CreateIndex
CREATE INDEX "alert_channels_project_id_idx" ON "alert_channels"("project_id");

-- CreateIndex
CREATE INDEX "alert_deliveries_channel_id_event_sent_at_idx" ON "alert_deliveries"("channel_id", "event", "sent_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "alert_deliveries_incident_id_channel_id_event_key" ON "alert_deliveries"("incident_id", "channel_id", "event");

-- AddForeignKey
ALTER TABLE "alert_channels" ADD CONSTRAINT "alert_channels_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "alert_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "alert_channels" ADD CONSTRAINT "alert_channels_cooldown" CHECK ("cooldown_minutes" BETWEEN 0 AND 1440);
ALTER TABLE "alert_channels" ADD CONSTRAINT "alert_channels_name_length" CHECK (char_length("name") BETWEEN 1 AND 60);
-- An active channel always has somewhere to send to.
ALTER TABLE "alert_channels" ADD CONSTRAINT "alert_channels_active_has_secret"
  CHECK ("state" <> 'active' OR "secret_enc" IS NOT NULL);
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_attempts" CHECK ("attempts" >= 0);
