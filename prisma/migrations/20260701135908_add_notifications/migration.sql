-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dedup_key" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_participant_id_type_dedup_key_key" ON "notifications"("participant_id", "type", "dedup_key");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
