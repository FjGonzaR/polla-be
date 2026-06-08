/*
  Warnings:

  - You are about to drop the column `reminder_sent` on the `matches` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "matches" DROP COLUMN "reminder_sent";

-- CreateTable
CREATE TABLE "match_reminders" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "match_reminders_match_id_participant_id_key" ON "match_reminders"("match_id", "participant_id");

-- AddForeignKey
ALTER TABLE "match_reminders" ADD CONSTRAINT "match_reminders_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_reminders" ADD CONSTRAINT "match_reminders_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
