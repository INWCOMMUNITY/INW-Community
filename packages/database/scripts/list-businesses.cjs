const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
prisma.business
  .findMany({
    select: { id: true, name: true, slug: true, categories: true },
    orderBy: { name: "asc" },
  })
  .then((rows) => {
    console.log(JSON.stringify(rows, null, 2));
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
