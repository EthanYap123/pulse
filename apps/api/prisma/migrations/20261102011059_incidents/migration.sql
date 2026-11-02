-- CreateEnum
CREATE TYPE "resolve_reason" AS ENUM ('recovered', 'paused', 'deleted');

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "monitor_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),
    "cause" "check_error" NOT NULL,
    "last_status_code" SMALLINT,
    "resolve_reason" "resolve_reason",
    "note" TEXT,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incidents_monitor_id_started_at_idx" ON "incidents"("monitor_id", "started_at" DESC);

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one open incident per monitor (docs/ARCHITECTURE.md §3.4, duplicate-alert layer 2).
-- The checker opens incidents with INSERT ... ON CONFLICT DO NOTHING against this index.
CREATE UNIQUE INDEX "incidents_one_open_per_monitor" ON "incidents" ("monitor_id") WHERE "resolved_at" IS NULL;

ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resolved_after_start"
  CHECK ("resolved_at" IS NULL OR "resolved_at" >= "started_at");
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_note_length" CHECK (char_length("note") <= 500);
