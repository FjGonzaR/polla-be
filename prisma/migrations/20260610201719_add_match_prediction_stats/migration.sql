-- CreateTable
CREATE TABLE "match_prediction_stats" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "total_predictions" INTEGER NOT NULL,
    "pct_home_win" DOUBLE PRECISION NOT NULL,
    "pct_draw" DOUBLE PRECISION NOT NULL,
    "pct_away_win" DOUBLE PRECISION NOT NULL,
    "pct_triple_active" DOUBLE PRECISION NOT NULL,
    "top_score_home" INTEGER,
    "top_score_away" INTEGER,
    "top_score_pct" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_prediction_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "match_prediction_stats_match_id_key" ON "match_prediction_stats"("match_id");

-- AddForeignKey
ALTER TABLE "match_prediction_stats" ADD CONSTRAINT "match_prediction_stats_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
