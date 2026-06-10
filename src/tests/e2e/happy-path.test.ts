import { describe, it, expect, vi } from 'vitest'
import { RoundSlug } from '@prisma/client'
import { buildServer } from '../../server.js'
import { prisma } from '../../lib/prisma.js'
import { seedScoringParams } from '../helpers/scoring.helper.js'
import { createAuthenticatedParticipant } from '../helpers/auth.helper.js'
import { buildInvitation } from '../builders/invitation.builder.js'
import { syncStandings } from '../../crons/sync-standings.js'
import { setQualifiedThirds } from '../../services/admin.service.js'
import type { WorldCupStanding } from '../../types/worldcup-api.types.js'

// --- Mocks ---

const { mockVerifyGoogleToken } = vi.hoisted(() => ({
  mockVerifyGoogleToken: vi.fn(),
}))
vi.mock('../../lib/google-auth.js', () => ({
  verifyGoogleToken: mockVerifyGoogleToken,
}))

const { mockGetStandings } = vi.hoisted(() => ({
  mockGetStandings: vi.fn(),
}))
vi.mock('../../lib/worldcup-api.client.js', () => ({
  worldcupApi: { getStandings: mockGetStandings },
}))

// --- Tournament fixture data ---

const GROUPS_DATA = [
  {
    label: 'A',
    name: 'Group A',
    teams: [
      { name: 'Mexico', code: 'MEX', isTop8: false },
      { name: 'South Africa', code: 'RSA', isTop8: false },
      { name: 'Korea Republic', code: 'KOR', isTop8: false },
      { name: 'Czech Republic', code: 'CZE', isTop8: false },
    ],
  },
  {
    label: 'B',
    name: 'Group B',
    teams: [
      { name: 'Canada', code: 'CAN', isTop8: false },
      { name: 'Bosnia and Herzegovina', code: 'BIH', isTop8: false },
      { name: 'Qatar', code: 'QAT', isTop8: false },
      { name: 'Switzerland', code: 'SUI', isTop8: false },
    ],
  },
  {
    label: 'C',
    name: 'Group C',
    teams: [
      { name: 'Brazil', code: 'BRA', isTop8: true },
      { name: 'Morocco', code: 'MAR', isTop8: true },
      { name: 'Haiti', code: 'HAI', isTop8: false },
      { name: 'Scotland', code: 'SCO', isTop8: false },
    ],
  },
  {
    label: 'D',
    name: 'Group D',
    teams: [
      { name: 'United States', code: 'USA', isTop8: false },
      { name: 'Paraguay', code: 'PAR', isTop8: false },
      { name: 'Australia', code: 'AUS', isTop8: false },
      { name: 'Turkey', code: 'TUR', isTop8: false },
    ],
  },
  {
    label: 'E',
    name: 'Group E',
    teams: [
      { name: 'Germany', code: 'GER', isTop8: false },
      { name: 'Curacao', code: 'CUW', isTop8: false },
      { name: 'Ivory Coast', code: 'CIV', isTop8: false },
      { name: 'Ecuador', code: 'ECU', isTop8: false },
    ],
  },
  {
    label: 'F',
    name: 'Group F',
    teams: [
      { name: 'Netherlands', code: 'NED', isTop8: true },
      { name: 'Japan', code: 'JPN', isTop8: false },
      { name: 'Sweden', code: 'SWE', isTop8: false },
      { name: 'Tunisia', code: 'TUN', isTop8: false },
    ],
  },
  {
    label: 'G',
    name: 'Group G',
    teams: [
      { name: 'Belgium', code: 'BEL', isTop8: false },
      { name: 'Egypt', code: 'EGY', isTop8: false },
      { name: 'Iran', code: 'IRN', isTop8: false },
      { name: 'New Zealand', code: 'NZL', isTop8: false },
    ],
  },
  {
    label: 'H',
    name: 'Group H',
    teams: [
      { name: 'Spain', code: 'ESP', isTop8: true },
      { name: 'Cape Verde', code: 'CPV', isTop8: false },
      { name: 'Saudi Arabia', code: 'KSA', isTop8: false },
      { name: 'Uruguay', code: 'URU', isTop8: false },
    ],
  },
  {
    label: 'I',
    name: 'Group I',
    teams: [
      { name: 'France', code: 'FRA', isTop8: true },
      { name: 'Senegal', code: 'SEN', isTop8: false },
      { name: 'Iraq', code: 'IRQ', isTop8: false },
      { name: 'Norway', code: 'NOR', isTop8: false },
    ],
  },
  {
    label: 'J',
    name: 'Group J',
    teams: [
      { name: 'Argentina', code: 'ARG', isTop8: true },
      { name: 'Algeria', code: 'ALG', isTop8: false },
      { name: 'Austria', code: 'AUT', isTop8: false },
      { name: 'Jordan', code: 'JOR', isTop8: false },
    ],
  },
  {
    label: 'K',
    name: 'Group K',
    teams: [
      { name: 'Portugal', code: 'POR', isTop8: true },
      { name: 'DR Congo', code: 'COD', isTop8: false },
      { name: 'Uzbekistan', code: 'UZB', isTop8: false },
      { name: 'Colombia', code: 'COL', isTop8: false },
    ],
  },
  {
    label: 'L',
    name: 'Group L',
    teams: [
      { name: 'England', code: 'ENG', isTop8: true },
      { name: 'Croatia', code: 'CRO', isTop8: false },
      { name: 'Ghana', code: 'GHA', isTop8: false },
      { name: 'Panama', code: 'PAN', isTop8: false },
    ],
  },
]

// --- Helpers ---

function apiStanding(
  label: string,
  teams: Array<{ extId: string; pts: number; gf: number; ga: number; mp: number }>,
): WorldCupStanding {
  return {
    _id: `ext-group-${label.toLowerCase()}`,
    name: label,
    teams: teams.map((t) => ({
      team_id: t.extId,
      pts: String(t.pts),
      gf: String(t.gf),
      ga: String(t.ga),
      gd: String(t.gf - t.ga),
      mp: String(t.mp),
    })),
  }
}

type TeamRecord = Record<string, { id: string; code: string; externalTeamId: string }>
type GroupRecord = Record<string, { id: string; label: string }>

async function setupTournament(): Promise<{ groups: GroupRecord; teams: TeamRecord }> {
  await seedScoringParams()

  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000)

  const groupRound = await prisma.round.create({
    data: { slug: RoundSlug.GROUP, name: 'Group Stage', order: 0, matchCount: 48 },
  })

  const groups: GroupRecord = {}
  const teams: TeamRecord = {}

  for (const gd of GROUPS_DATA) {
    const group = await prisma.group.create({
      data: { label: gd.label, name: gd.name, lastMatchAt: threeHoursAgo },
    })
    groups[gd.label] = { id: group.id, label: gd.label }

    for (let i = 0; i < gd.teams.length; i++) {
      const td = gd.teams[i]
      const externalTeamId = `ext-${gd.label.toLowerCase()}-${i}`
      const team = await prisma.team.create({
        data: {
          name: td.name,
          code: td.code,
          groupId: group.id,
          isTop8: td.isTop8,
          externalTeamId,
        },
      })
      teams[td.code] = { id: team.id, code: td.code, externalTeamId }
    }
  }

  // Past match so GET /groups/predictions/friends returns available: true
  // (service checks: firstMatch.scheduledAt > new Date())
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  await prisma.match.create({
    data: {
      roundId: groupRound.id,
      matchNumber: 1,
      scheduledAt: oneDayAgo,
      homeTeamId: teams['MEX'].id,
      awayTeamId: teams['RSA'].id,
    },
  })

  return { groups, teams }
}

function buildApiStandings(
  teamsMap: TeamRecord,
): WorldCupStanding[] {
  return GROUPS_DATA.map((gd) =>
    apiStanding(
      gd.label,
      gd.teams.map((td, i) => ({
        extId: teamsMap[td.code].externalTeamId,
        // Descending pts so index 0 → pos1, index 1 → pos2, etc.
        pts: (3 - i) * 3,
        gf: (3 - i) * 2 + 1,
        ga: i + 1,
        mp: 3,
      })),
    ),
  )
}

// --- Test ---

describe('E2E: user happy path — group phase', () => {
  it('login → group predictions → thirds → powerups → cron sync → view friends → scoreboard', async () => {
    const server = await buildServer()

    // ── Setup ────────────────────────────────────────────────────────────────
    const { groups, teams } = await setupTournament()

    // ── Step 1: Google login (signup flow — new user needs invitation code) ───
    const invitation = await buildInvitation({ code: 'HAPPY-PATH-01' })

    mockVerifyGoogleToken.mockResolvedValue({
      sub: 'google-user-123',
      email: 'player@test.com',
      name: 'Player One',
    })

    const loginRes = await server.inject({
      method: 'POST',
      url: '/auth/google',
      payload: {
        credential: 'mock-google-token',
        code: invitation.code,
        phone: '+573001234567',
      },
    })

    expect(loginRes.statusCode).toBe(200)
    const rawCookie = loginRes.headers['set-cookie'] as string
    expect(rawCookie).toMatch(/session=/)
    const cookie = rawCookie.split(';')[0]

    // ── Step 2: Group predictions (all 12 groups) ────────────────────────────
    // User ranks: teams[0]=pos1, teams[1]=pos2, teams[2]=pos3, teams[3]=pos4
    const predictions = GROUPS_DATA.map((gd) => ({
      groupId: groups[gd.label].id,
      rankings: gd.teams.map((td, i) => ({
        teamId: teams[td.code].id,
        position: i + 1,
      })),
    }))

    const groupPredRes = await server.inject({
      method: 'POST',
      url: '/groups/predictions',
      headers: { cookie },
      payload: { predictions },
    })

    expect(groupPredRes.statusCode).toBe(200)
    expect(groupPredRes.json().savedGroups).toBe(12)

    const groupPredCount = await prisma.groupPrediction.count()
    expect(groupPredCount).toBe(48)

    // ── Step 3: Third predictions (8 teams at position 3, groups A–H) ────────
    // teams[2] in each group is at predicted position 3
    const thirdTeamCodes = ['KOR', 'QAT', 'HAI', 'AUS', 'CIV', 'SWE', 'IRN', 'KSA']
    const thirdsRes = await server.inject({
      method: 'POST',
      url: '/groups/thirds',
      headers: { cookie },
      payload: { teamIds: thirdTeamCodes.map((code) => teams[code].id) },
    })

    expect(thirdsRes.statusCode).toBe(200)
    expect(thirdsRes.json().selectedCount).toBe(8)

    const thirdCount = await prisma.thirdPrediction.count()
    expect(thirdCount).toBe(8)

    // ── Step 4: Powerups ─────────────────────────────────────────────────────
    // Dark horse: MEX (isTop8: false), Disappointment: BRA (isTop8: true)
    const powerupsRes = await server.inject({
      method: 'POST',
      url: '/powerups/predictions',
      headers: { cookie },
      payload: {
        darkHorseTeamId: teams['MEX'].id,
        disappointmentTeamId: teams['BRA'].id,
      },
    })

    expect(powerupsRes.statusCode).toBe(201)
    expect(powerupsRes.json().darkHorse.isTop8).toBe(false)
    expect(powerupsRes.json().disappointment.isTop8).toBe(true)

    const powerup = await prisma.powerup.findFirst()
    expect(powerup).not.toBeNull()

    // ── Step 5: Friend also makes group predictions (reversed rankings) ───────
    const { participant: friend, cookie: friendCookie } = await createAuthenticatedParticipant({
      name: 'Friend Two',
    })

    // Friend gets pos1 correct (teams[0]=pos1) but shuffles the rest
    // i=0→pos1 (correct), i=1→pos3, i=2→pos4, i=3→pos2
    const friendPositionFor = (i: number) => [1, 3, 4, 2][i]
    const friendPredictions = GROUPS_DATA.map((gd) => ({
      groupId: groups[gd.label].id,
      rankings: gd.teams.map((td, i) => ({
        teamId: teams[td.code].id,
        position: friendPositionFor(i),
      })),
    }))

    const friendGroupPredRes = await server.inject({
      method: 'POST',
      url: '/groups/predictions',
      headers: { cookie: friendCookie },
      payload: { predictions: friendPredictions },
    })

    expect(friendGroupPredRes.statusCode).toBe(200)
    expect(friendGroupPredRes.json().savedGroups).toBe(12)

    // ── Step 6: Sync standings cron (all 12 groups finalize, score events created) ──
    // API returns real positions matching user's predictions (teams[0] → pos1, etc.)
    mockGetStandings.mockResolvedValue(buildApiStandings(teams))
    await syncStandings()

    // ── Step 6b: Admin sets qualified thirds (groups A–H qualify) ─────────────
    await setQualifiedThirds(thirdTeamCodes.map((code) => teams[code].id))

    // Fetch the user participant created during login
    const userParticipant = await prisma.participant.findFirst({
      where: { email: 'player@test.com' },
    })
    expect(userParticipant).not.toBeNull()

    // User should have score events (all 12 groups correct + bonuses)
    const userScoreEvents = await prisma.scoreEvent.findMany({
      where: { participantId: userParticipant!.id },
    })
    expect(userScoreEvents.length).toBeGreaterThan(0)

    // Friend has score events (pos1 correct in every group = 12 hits, no bonus)
    const friendScoreEvents = await prisma.scoreEvent.findMany({
      where: { participantId: friend.id },
    })
    expect(friendScoreEvents.length).toBeGreaterThan(0)

    // ── Step 7: View friend's group predictions ───────────────────────────────
    // Available because a past match exists (firstMatch.scheduledAt < now)
    const friendsRes = await server.inject({
      method: 'GET',
      url: '/groups/predictions/friends',
      headers: { cookie },
    })

    expect(friendsRes.statusCode).toBe(200)
    const friendsBody = friendsRes.json()
    expect(friendsBody.available).toBe(true)
    expect(friendsBody.data).toHaveLength(1)
    expect(friendsBody.data[0].participant.id).toBe(friend.id)

    // Friend's group A: pos2 is CZE (teams[3], friendPositionFor(3)=2), not RSA (user's pos2)
    const friendFirstGroup = friendsBody.data[0].predictions[0]
    const friendGroupAPos2 = friendFirstGroup.rankings.find(
      (r: { predictedPosition: number }) => r.predictedPosition === 2,
    )
    expect(friendGroupAPos2.teamId ?? friendGroupAPos2.id).toBe(teams['CZE'].id)

    // ── Step 8: Scoreboard ────────────────────────────────────────────────────
    const scoreboardRes = await server.inject({
      method: 'GET',
      url: '/scoreboard',
      headers: { cookie },
    })

    expect(scoreboardRes.statusCode).toBe(200)
    const scoreboard = scoreboardRes.json()
    expect(scoreboard.data).toHaveLength(2)

    const userEntry = scoreboard.data[0]
    const friendEntry = scoreboard.data[1]

    // User: 4 exact positions per group × pts_group_position_exact(3) + bonus_group_complete(5)
    //       = (4×3 + 5) × 12 groups = 17 × 12 = 204
    // + thirds: all 12 pos3 teams have identical stats so 8 qualify;
    //   user selected thirds from groups A–H → all 8 qualify → 8 × pts_third_correct(2) = 16
    // Total: 204 + 16 = 220
    const EXPECTED_USER_TOTAL = 220
    // Friend: only pos1 correct per group × pts_group_position_exact(3), no bonus
    //         = 3 × 12 groups = 36
    const EXPECTED_FRIEND_TOTAL = 36

    expect(userEntry.rank).toBe(1)
    expect(userEntry.participant.id).toBe(userParticipant!.id)
    expect(userEntry.total).toBe(EXPECTED_USER_TOTAL)
    expect(userEntry.prize).toBe(700000)

    expect(friendEntry.rank).toBe(2)
    expect(friendEntry.participant.id).toBe(friend.id)
    expect(friendEntry.total).toBe(EXPECTED_FRIEND_TOTAL)
    expect(friendEntry.prize).toBe(250000)
  })
})
