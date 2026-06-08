-- DropForeignKey
ALTER TABLE "participants" DROP CONSTRAINT "participants_invitation_id_fkey";

-- AlterTable
ALTER TABLE "participants" ALTER COLUMN "invitation_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "invitations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
