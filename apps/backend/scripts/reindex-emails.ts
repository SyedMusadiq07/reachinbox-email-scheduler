import "dotenv/config";
import { prisma } from "../src/db/prisma.js";
import { closeElasticsearchClient } from "../src/search/elasticsearch.js";
import { indexEmailJobs } from "../src/search/email-index.processor.js";

let reindexPhase = "PostgreSQL batch read";

async function main(): Promise<void> {
  const batchSize = 500;
  let offset = 0;
  let indexed = 0;
  try {
    while (true) {
      const batch = await prisma.emailJob.findMany({
        skip: offset,
        take: batchSize,
        orderBy: { id: "asc" },
        include: { campaign: { select: { userId: true } } },
      });
      if (batch.length === 0) break;
      reindexPhase = "Elasticsearch bulk index";
      indexed += await indexEmailJobs(batch);
      offset += batch.length;
      reindexPhase = "PostgreSQL batch read";
    }
    console.log(`Reindexed ${indexed} EmailJob records from PostgreSQL.`);
  } finally {
    await closeElasticsearchClient();
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const errorName = typeof error === "object" && error !== null ? error.constructor?.name : typeof error;
    console.error(`Email reindex failed during ${reindexPhase} (${errorName ?? "unknown error type"}): ${error instanceof Error ? error.message : "non-Error exception"}`);
  process.exitCode = 1;
});
