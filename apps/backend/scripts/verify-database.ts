import "dotenv/config";
import { prisma } from "../src/db/prisma.js";

async function verifyDatabase(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log("Neon PostgreSQL connectivity verified.");
  } catch {
    console.error("Neon PostgreSQL connectivity check failed.");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void verifyDatabase();
