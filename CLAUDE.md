# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Dev (hot-reload via tsx)
npm run dev

# Build TypeScript → dist/
npm run build

# Start compiled output
npm start

# Prisma
npx prisma migrate dev       # apply migrations locally
npx prisma migrate deploy    # apply in prod
npx prisma generate          # regenerate client after schema changes
npx prisma studio            # GUI for DB

# Local DB (Docker)
docker compose up db -d      # start only the DB container (port 5433)
docker compose up            # full stack (app + DB)
```

No test suite exists yet.

## Environment

Copy `.env.example` → `.env`. Key vars:
- `DATABASE_URL` — local dev uses `localhost:5433`, Docker Compose uses `db:5432`
- `WORLDCUP_API_URL` — defaults to `https://worldcup26.ir`
- `NODE_ENV=test` disables cron registration

## Architecture

**Stack:** Fastify + Prisma + PostgreSQL + TypeScript. No ORM abstraction layer — Prisma client used directly in services and crons.

**Entry point:** `src/server.ts` — registers CORS, Prisma plugin, routes, and cron schedules.

**Prisma plugin** (`src/plugins/prisma.ts`) decorates the Fastify instance as `fastify.prisma`. Routes access DB through this. Direct imports of `src/lib/prisma.ts` (singleton) are used in services/crons outside the request lifecycle.

**External data source:** `src/lib/worldcup-api.client.ts` wraps `https://worldcup26.ir`. Used by both crons. Teams/matches are linked via `externalTeamId` / `externalMatchId` fields.

**Crons** (run at server start + on schedule, skipped when `NODE_ENV=test`):
- `sync-standings` — 11h, 17h, 23h UTC — fetches group standings from external API, upserts `GroupStanding`
- `sync-ko-results` — every 30 min 17-23h + 0-6h UTC — fetches results for unfinished KO matches scheduled 120+ min ago

**Planned crons** (not yet implemented per docs):
- `lock-match` — every minute — sets `match.locked_at` for upcoming KO matches
- `whatsapp-reminder` — every 30 min — WhatsApp notifications for upcoming matches
- `recalculate-scores` — 1AM daily — precalculates scoreboard cache

## Domain Model

Private World Cup 2026 predictions pool (~20 participants, invite-only).

**Tournament structure:** 48 teams, 12 groups (A–L), 4 teams each. 32 qualify (2 per group + 8 best thirds). KO rounds: R32 → R16 → QF → SF → THIRD → FINAL. Tournament: Jun 11 – Jul 19, 2026.

**Prediction types:**
- `group_predictions` — predicted position (1–4) per team per group
- `third_predictions` — 8 best thirds selection (must be teams predicted 3rd in their group)
- `powerups` — one per participant: `dark_horse` (must have `is_top8=false`) + `disappointment` (must have `is_top8=true`)
- `ko_predictions` — exact score + advancing team per KO match. `triple_active` flag (max 3 per participant total)

**Locking rules:**
- Groups/thirds/powerups lock before the first match (Jun 11 2026)
- KO matches lock 30 min before `scheduled_at` (`match.locked_at`)
- Locked writes return `423 Locked`

**Scoring params** are stored in `scoring_params` table (editable by admin, read on each calculation). Key params: `pts_group_position_exact`, `pts_ko_advances`, `pts_ko_exact_score`, `mult_triple` (default 3), round scale multipliers (`scale_r32` through `scale_final`).

**KO scoring nuance:** `winner_team_id` may differ from score (penalties). `pts_ko_advances` based on `team_advances_id`, `pts_ko_exact_score` requires both score AND `team_advances_id` correct.

**Triple or nothing:** If `triple_active=true` and exact score missed → 0 pts for that match even if advancing team correct.

**Scoreboard:** Calculated on-demand at `GET /scoreboard`. Tiebreaker: most exact KO scores. Prizes: 700K / 250K / 50K COP for ranks 1–3.

## Planned Endpoints (not yet implemented)

See `docs/EPs definition.md` for full contract. Not-yet-built routes:
- `/auth/*` (Google SSO, join with invite code, phone registration)
- `/admin/*` (invitations, group/match loading, result entry, scoring params)
- `/groups/*` (predictions CRUD, thirds)
- `/ko/*` (matches, predictions)
- `/powerups/*`
- `/scoreboard`
