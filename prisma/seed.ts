import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const params = [
    {
      key: "pts_group_position_exact",
      value: 5,
      description: "Points per exact group position",
    },
    {
      key: "bonus_group_complete",
      value: 20,
      description: "Bonus if all 4 positions exact in a group",
    },
    {
      key: "pts_third_correct",
      value: 10,
      description: "Points per correct third-place team",
    },
    {
      key: "pts_ko_advances",
      value: 2,
      description: "Points for correct advancing team",
    },
    {
      key: "pts_ko_exact_score",
      value: 3,
      description: "Points for exact score",
    },
    {
      key: "mult_triple",
      value: 3,
      description: "Triple or nothing multiplier",
    },
    {
      key: "pts_dark_horse_per_round",
      value: 5,
      description: "Points per round dark horse advances",
    },
    {
      key: "pts_disappointment_per_round",
      value: 5,
      description: "Points per round disappointment is eliminated",
    },
    {
      key: "scale_group",
      value: 1,
      description: "Group-phase scale multiplier (powerup qualification)",
    },
    { key: "scale_r32", value: 2, description: "R32 scale multiplier" },
    { key: "scale_r16", value: 3, description: "R16 scale multiplier" },
    { key: "scale_qf", value: 5, description: "QF scale multiplier" },
    { key: "scale_sf", value: 7, description: "SF scale multiplier" },
    { key: "scale_final", value: 10, description: "Final scale multiplier" },
  ];

  for (const param of params) {
    await prisma.scoringParam.upsert({
      where: { key: param.key },
      update: {},
      create: param,
    });
  }

  console.log(`Seeded ${params.length} scoring params`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
