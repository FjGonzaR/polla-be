-- CreateEnum
CREATE TYPE "SourceOutcome" AS ENUM ('WINNER', 'LOSER');

-- AlterTable
ALTER TABLE "matches" ADD COLUMN     "away_source_match_id" TEXT,
ADD COLUMN     "away_source_outcome" "SourceOutcome",
ADD COLUMN     "home_source_match_id" TEXT,
ADD COLUMN     "home_source_outcome" "SourceOutcome";

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_home_source_match_id_fkey" FOREIGN KEY ("home_source_match_id") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_away_source_match_id_fkey" FOREIGN KEY ("away_source_match_id") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
