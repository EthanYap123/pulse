-- CreateEnum
CREATE TYPE "http_method" AS ENUM ('GET', 'HEAD');

-- CreateEnum
CREATE TYPE "monitor_status" AS ENUM ('pending', 'up', 'failing', 'down', 'recovering', 'paused');

-- CreateEnum
CREATE TYPE "check_error" AS ENUM ('status', 'timeout', 'dns', 'tls', 'connection');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "status_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "method" "http_method" NOT NULL DEFAULT 'GET',
    "expected_status_min" SMALLINT NOT NULL DEFAULT 200,
    "expected_status_max" SMALLINT NOT NULL DEFAULT 399,
    "timeout_ms" SMALLINT NOT NULL DEFAULT 8000,
    "failure_threshold" SMALLINT NOT NULL DEFAULT 3,
    "headers" JSONB NOT NULL DEFAULT '{}',
    "is_paused" BOOLEAN NOT NULL DEFAULT false,
    "show_on_status_page" BOOLEAN NOT NULL DEFAULT true,
    "shard" SMALLINT NOT NULL,
    "last_status" "monitor_status" NOT NULL DEFAULT 'pending',
    "last_checked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_results" (
    "monitor_id" UUID NOT NULL,
    "checked_at" TIMESTAMPTZ(3) NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "status_code" SMALLINT,
    "latency_ms" INTEGER,
    "error" "check_error",

    CONSTRAINT "check_results_pkey" PRIMARY KEY ("monitor_id","checked_at")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_slug_key" ON "projects"("slug");

-- CreateIndex
CREATE INDEX "projects_owner_id_idx" ON "projects"("owner_id");

-- CreateIndex
CREATE INDEX "monitors_project_id_idx" ON "monitors"("project_id");

-- CreateIndex
CREATE INDEX "monitors_shard_idx" ON "monitors"("shard");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CHECK constraints (not modelled by Prisma). They mirror the zod schemas in packages/shared.
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));
ALTER TABLE "projects" ADD CONSTRAINT "projects_slug_format" CHECK ("slug" ~ '^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$');
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_expected_status_range"
  CHECK ("expected_status_min" BETWEEN 100 AND 599
     AND "expected_status_max" BETWEEN 100 AND 599
     AND "expected_status_min" <= "expected_status_max");
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_timeout_ms" CHECK ("timeout_ms" BETWEEN 1000 AND 8000);
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_failure_threshold" CHECK ("failure_threshold" BETWEEN 1 AND 5);
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_shard" CHECK ("shard" BETWEEN 0 AND 4);
