-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "externalTeamId" TEXT;

-- CreateTable
CREATE TABLE "group_standings" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "pts" INTEGER NOT NULL DEFAULT 0,
    "goals_for" INTEGER NOT NULL DEFAULT 0,
    "goals_against" INTEGER NOT NULL DEFAULT 0,
    "real_position" INTEGER,
    "qualified_as_third" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_standings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "group_standings_team_id_key" ON "group_standings"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "teams_externalTeamId_key" ON "teams"("externalTeamId");

-- AddForeignKey
ALTER TABLE "group_standings" ADD CONSTRAINT "group_standings_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_standings" ADD CONSTRAINT "group_standings_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
