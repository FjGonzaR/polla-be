import { prisma } from '../lib/prisma.js'
import { AppError } from '../lib/errors.js'

interface ThirdCandidateDto {
  teamId: string
  name: string
  code: string
  groupId: string
  label: string
  selected: boolean
  pointsEarned: null
}

interface ThirdsDto {
  selectedCount: number
  data: ThirdCandidateDto[]
}

export async function findMyThirds(participantId: string): Promise<ThirdsDto> {
  const [candidates, selected] = await Promise.all([
    prisma.groupPrediction.findMany({
      where: { participantId, predictedPosition: 3 },
      include: { team: true, group: true },
    }),
    prisma.thirdPrediction.findMany({ where: { participantId } }),
  ])

  const selectedSet = new Set(selected.map((t) => t.teamId))

  const data: ThirdCandidateDto[] = candidates.map((c) => ({
    teamId: c.teamId,
    name: c.team.name,
    code: c.team.code,
    groupId: c.groupId,
    label: c.group.label,
    selected: selectedSet.has(c.teamId),
    pointsEarned: null,
  }))

  return { selectedCount: selected.length, data }
}

export async function saveThirds(
  participantId: string,
  teamIds: string[],
): Promise<{ ok: true; selectedCount: number }> {
  if (teamIds.length !== 8) {
    throw new AppError(400, 'INVALID_THIRDS_COUNT', 'Must select exactly 8 teams')
  }

  const candidates = await prisma.groupPrediction.findMany({
    where: { participantId, predictedPosition: 3 },
    select: { teamId: true },
  })
  const candidateSet = new Set(candidates.map((c) => c.teamId))

  for (const id of teamIds) {
    if (!candidateSet.has(id)) {
      throw new AppError(400, 'INVALID_THIRD_CANDIDATE', `Team ${id} is not a valid third candidate`)
    }
  }

  await prisma.$transaction([
    prisma.thirdPrediction.deleteMany({ where: { participantId } }),
    prisma.thirdPrediction.createMany({
      data: teamIds.map((teamId) => ({ participantId, teamId })),
    }),
  ])

  return { ok: true, selectedCount: 8 }
}
