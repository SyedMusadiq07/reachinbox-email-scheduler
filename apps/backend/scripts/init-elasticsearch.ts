import "dotenv/config";
import { closeElasticsearchClient, ensureEmailSearchIndex, verifyElasticsearchConnection } from "../src/search/elasticsearch.js";

async function main(): Promise<void> {
  try {
    await verifyElasticsearchConnection();
    await ensureEmailSearchIndex();
    console.log("Elasticsearch is reachable and the emails index is ready.");
  } finally {
    await closeElasticsearchClient();
  }
}

main().catch((error: unknown) => {
  console.error(`Elasticsearch initialization failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
