-- AlterTable: add last_match_at to groups
ALTER TABLE "groups" ADD COLUMN "last_match_at" TIMESTAMP(3);

-- AlterTable: add matches_played to group_standings
ALTER TABLE "group_standings" ADD COLUMN "matches_played" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: score_events
CREATE TABLE "score_events" (
    "id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "param_key" TEXT NOT NULL,
    "match_id" TEXT,
    "group_id" TEXT,
    "round_slug" "RoundSlug",
    "points" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_events_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
