-- CreateEnum
CREATE TYPE "PowerupType" AS ENUM ('DARK_HORSE', 'DISAPPOINTMENT');

-- CreateTable
CREATE TABLE "powerup_stats" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "type" "PowerupType" NOT NULL,
    "pct" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "powerup_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "powerup_stats_team_id_type_key" ON "powerup_stats"("team_id", "type");

-- AddForeignKey
ALTER TABLE "powerup_stats" ADD CONSTRAINT "powerup_stats_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
