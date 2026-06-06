-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'LIVE', 'FINISHED');
CREATE TYPE "InvitationStatus" AS ENUM ('AVAILABLE', 'USED', 'EXPIRED');
CREATE TYPE "ParticipantRole" AS ENUM ('PARTICIPANT', 'ADMIN');
CREATE TYPE "RoundSlug" AS ENUM ('GROUP', 'R32', 'R16', 'QF', 'SF', 'THIRD', 'FINAL');

-- Migrate existing data to uppercase enum values
UPDATE "matches"      SET "status" = 'SCHEDULED' WHERE "status" = 'scheduled';
UPDATE "matches"      SET "status" = 'LIVE'      WHERE "status" = 'live';
UPDATE "matches"      SET "status" = 'FINISHED'  WHERE "status" = 'finished';

UPDATE "invitations"  SET "status" = 'AVAILABLE' WHERE "status" = 'available';
UPDATE "invitations"  SET "status" = 'USED'      WHERE "status" = 'used';
UPDATE "invitations"  SET "status" = 'EXPIRED'   WHERE "status" = 'expired';

UPDATE "participants" SET "role" = 'PARTICIPANT' WHERE "role" = 'participant';
UPDATE "participants" SET "role" = 'ADMIN'       WHERE "role" = 'admin';

UPDATE "rounds" SET "slug" = 'GROUP' WHERE "slug" = 'group';
UPDATE "rounds" SET "slug" = 'R32'   WHERE "slug" = 'r32';
UPDATE "rounds" SET "slug" = 'R16'   WHERE "slug" = 'r16';
UPDATE "rounds" SET "slug" = 'QF'    WHERE "slug" = 'qf';
UPDATE "rounds" SET "slug" = 'SF'    WHERE "slug" = 'sf';
UPDATE "rounds" SET "slug" = 'THIRD' WHERE "slug" = '3rd';
UPDATE "rounds" SET "slug" = 'FINAL' WHERE "slug" = 'final';

-- AlterTable matches
ALTER TABLE "matches" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "matches" ALTER COLUMN "status" TYPE "MatchStatus" USING "status"::"MatchStatus";
ALTER TABLE "matches" ALTER COLUMN "status" SET DEFAULT 'SCHEDULED'::"MatchStatus";

-- AlterTable invitations
ALTER TABLE "invitations" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "invitations" ALTER COLUMN "status" TYPE "InvitationStatus" USING "status"::"InvitationStatus";
ALTER TABLE "invitations" ALTER COLUMN "status" SET DEFAULT 'AVAILABLE'::"InvitationStatus";

-- AlterTable participants
ALTER TABLE "participants" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "participants" ALTER COLUMN "role" TYPE "ParticipantRole" USING "role"::"ParticipantRole";
ALTER TABLE "participants" ALTER COLUMN "role" SET DEFAULT 'PARTICIPANT'::"ParticipantRole";

-- AlterTable rounds
ALTER TABLE "rounds" ALTER COLUMN "slug" TYPE "RoundSlug" USING "slug"::"RoundSlug";
