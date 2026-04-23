import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const sevenWondersDuel = await prisma.game.upsert({
    where: { slug: "7-wonders-duel" },
    update: {},
    create: {
      slug: "7-wonders-duel",
      name: "7 Wonders Duel",
      description:
        "A two-player strategy game where you lead a civilization and build architectural wonders.",
      minPlayers: 2,
      maxPlayers: 2,
      config: {
        categories: [
          { key: "military", label: "Military", color: "#dc2626", min: 0, max: 9 },
          { key: "treasury", label: "Treasury", color: "#ca8a04", min: 0 },
          { key: "wonders", label: "Wonders", color: "#7c3aed" },
          { key: "civil", label: "Civil", color: "#2563eb" },
          { key: "scientific", label: "Scientific", color: "#16a34a" },
          { key: "commercial", label: "Commercial", color: "#ea580c" },
          { key: "guilds", label: "Guilds", color: "#9333ea" },
        ],
        victoryTypes: ["score", "military_supremacy", "scientific_supremacy"],
      },
    },
  });

  const skullKing = await prisma.game.upsert({
    where: { slug: "skull-king" },
    update: {},
    create: {
      slug: "skull-king",
      name: "Skull King",
      description:
        "A trick-taking pirate card game where you bid on how many tricks you will win each round.",
      minPlayers: 2,
      maxPlayers: 8,
      config: {
        rounds: 10,
        variants: ["classic", "rascal"],
        bonuses: {
          skullKingCapturesPirate: 30,
          pirateCapturesMermaid: 20,
          mermaidCapturesSkullKing: 40,
          black14: 20,
          colored14: 10,
        },
      },
    },
  });

  console.log(`Seeded games: ${sevenWondersDuel.name}, ${skullKing.name}`);
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
