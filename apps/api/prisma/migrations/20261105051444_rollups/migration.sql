-- CreateTable
CREATE TABLE "check_rollups_hourly" (
    "monitor_id" UUID NOT NULL,
    "hour" TIMESTAMPTZ(3) NOT NULL,
    "checks" INTEGER NOT NULL,
    "failures" INTEGER NOT NULL,
    "latency_avg_ms" INTEGER,
    "latency_p95_ms" INTEGER,
    "latency_max_ms" INTEGER,

    CONSTRAINT "check_rollups_hourly_pkey" PRIMARY KEY ("monitor_id","hour")
);

-- CreateTable
CREATE TABLE "check_rollups_daily" (
    "monitor_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "checks" INTEGER NOT NULL,
    "failures" INTEGER NOT NULL,
    "latency_avg_ms" INTEGER,
    "latency_p95_ms" INTEGER,

    CONSTRAINT "check_rollups_daily_pkey" PRIMARY KEY ("monitor_id","day")
);

-- AddForeignKey
ALTER TABLE "check_rollups_hourly" ADD CONSTRAINT "check_rollups_hourly_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_rollups_daily" ADD CONSTRAINT "check_rollups_daily_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
