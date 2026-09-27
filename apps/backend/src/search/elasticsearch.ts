import "dotenv/config";
import { Client } from "@elastic/elasticsearch";

export const EMAIL_SEARCH_INDEX = "emails";
let client: Client | undefined;

export function getElasticsearchClient(): Client {
  if (client) return client;
  const node = process.env.ELASTICSEARCH_URL;
  if (!node) throw new Error("ELASTICSEARCH_URL must be configured to use email search.");
  client = new Client({ node });
  return client;
}

export async function ensureEmailSearchIndex(): Promise<void> {
  const elastic = getElasticsearchClient();
  if (await elastic.indices.exists({ index: EMAIL_SEARCH_INDEX })) return;
  try {
    await elastic.indices.create({
      index: EMAIL_SEARCH_INDEX,
      mappings: { properties: {
        id: { type: "keyword" }, userId: { type: "keyword" },
        campaignId: { type: "keyword" }, senderId: { type: "keyword" },
        recipientEmail: { type: "keyword", fields: { search: { type: "text" } } },
        subject: { type: "text" }, body: { type: "text" }, status: { type: "keyword" },
        scheduledAt: { type: "date" }, sentAt: { type: "date" }, updatedAt: { type: "date" },
      } },
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "meta" in error) {
      const meta = error.meta as { body?: { error?: { type?: string } } };
      if (meta.body?.error?.type === "resource_already_exists_exception") return;
    }
    throw error;
  }
}

export async function verifyElasticsearchConnection(): Promise<void> {
  const health = await getElasticsearchClient().cluster.health();
  if (health.status === "red") throw new Error("Elasticsearch cluster health is red.");
}

export async function closeElasticsearchClient(): Promise<void> {
  if (!client) return;
  const current = client;
  client = undefined;
  await current.close();
}
