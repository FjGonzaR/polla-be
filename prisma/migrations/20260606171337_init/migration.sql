-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participants" (
    "id" TEXT NOT NULL,
    "google_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "has_phone" BOOLEAN NOT NULL DEFAULT false,
    "role" TEXT NOT NULL DEFAULT 'participant',
    "invitation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "is_top8" BOOLEAN NOT NULL DEFAULT false,
    "group_id" TEXT NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rounds" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "match_count" INTEGER NOT NULL,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" TEXT NOT NULL,
    "round_id" TEXT NOT NULL,
    "match_number" INTEGER NOT NULL,
    "home_team_id" TEXT,
    "away_team_id" TEXT,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "locked_at" TIMESTAMP(3),
    "reminder_sent" BOOLEAN NOT NULL DEFAULT false,
    "score_home" INTEGER,
    "score_away" INTEGER,
    "winner_team_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_predictions" (
    "id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "predicted_position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "third_predictions" (
    "id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "third_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "powerups" (
    "id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "dark_horse_team_id" TEXT NOT NULL,
    "disappointment_team_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "powerups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ko_predictions" (
    "id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "score_home" INTEGER NOT NULL,
    "score_away" INTEGER NOT NULL,
    "team_advances_id" TEXT NOT NULL,
    "triple_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ko_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoring_params" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" DECIMAL(65,30) NOT NULL,
    "description" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scoring_params_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_code_key" ON "invitations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "participants_google_id_key" ON "participants"("google_id");

-- CreateIndex
CREATE UNIQUE INDEX "participants_email_key" ON "participants"("email");

-- CreateIndex
CREATE UNIQUE INDEX "participants_invitation_id_key" ON "participants"("invitation_id");

-- CreateIndex
CREATE UNIQUE INDEX "groups_label_key" ON "groups"("label");

-- CreateIndex
CREATE UNIQUE INDEX "teams_code_key" ON "teams"("code");

-- CreateIndex
CREATE UNIQUE INDEX "rounds_slug_key" ON "rounds"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "group_predictions_participant_id_group_id_team_id_key" ON "group_predictions"("participant_id", "group_id", "team_id");

-- CreateIndex
CREATE UNIQUE INDEX "group_predictions_participant_id_group_id_predicted_positio_key" ON "group_predictions"("participant_id", "group_id", "predicted_position");

-- CreateIndex
CREATE UNIQUE INDEX "third_predictions_participant_id_team_id_key" ON "third_predictions"("participant_id", "team_id");

-- CreateIndex
CREATE UNIQUE INDEX "powerups_participant_id_key" ON "powerups"("participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "ko_predictions_participant_id_match_id_key" ON "ko_predictions"("participant_id", "match_id");

-- CreateIndex
CREATE UNIQUE INDEX "scoring_params_key_key" ON "scoring_params"("key");

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "invitations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_home_team_id_fkey" FOREIGN KEY ("home_team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_away_team_id_fkey" FOREIGN KEY ("away_team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_team_id_fkey" FOREIGN KEY ("winner_team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_predictions" ADD CONSTRAINT "group_predictions_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_predictions" ADD CONSTRAINT "group_predictions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_predictions" ADD CONSTRAINT "group_predictions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "third_predictions" ADD CONSTRAINT "third_predictions_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "third_predictions" ADD CONSTRAINT "third_predictions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "powerups" ADD CONSTRAINT "powerups_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "powerups" ADD CONSTRAINT "powerups_dark_horse_team_id_fkey" FOREIGN KEY ("dark_horse_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "powerups" ADD CONSTRAINT "powerups_disappointment_team_id_fkey" FOREIGN KEY ("disappointment_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ko_predictions" ADD CONSTRAINT "ko_predictions_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ko_predictions" ADD CONSTRAINT "ko_predictions_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ko_predictions" ADD CONSTRAINT "ko_predictions_team_advances_id_fkey" FOREIGN KEY ("team_advances_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
