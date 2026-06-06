-- AlterTable
ALTER TABLE "matches" ADD COLUMN "external_match_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "matches_external_match_id_key" ON "matches"("external_match_id");
