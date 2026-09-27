import { prisma } from "../db/prisma.js";
import { EMAIL_SEARCH_INDEX, ensureEmailSearchIndex, getElasticsearchClient } from "./elasticsearch.js";

type IndexableEmail = {
  id: string; userId: string; campaignId: string; senderId: string; recipientEmail: string;
  subject: string; body: string; status: string; scheduledAt: string; sentAt: string | null; updatedAt: string;
};

function asDocument(record: {
  id: string; campaignId: string; senderId: string; recipientEmail: string; subject: string;
  body: string; status: string; scheduledAt: Date; sentAt: Date | null; updatedAt: Date;
  campaign: { userId: string };
}): IndexableEmail {
  return {
    id: record.id, userId: record.campaign.userId, campaignId: record.campaignId,
    senderId: record.senderId, recipientEmail: record.recipientEmail, subject: record.subject,
    body: record.body, status: record.status, scheduledAt: record.scheduledAt.toISOString(),
    sentAt: record.sentAt?.toISOString() ?? null, updatedAt: record.updatedAt.toISOString(),
  };
}

const monotonicUpdateScript = "if (ctx._source.updatedAt == null || params.doc.updatedAt.compareTo(ctx._source.updatedAt) >= 0) { ctx._source = params.doc; } else { ctx.op = 'noop'; }";

export async function indexEmailJob(emailJobId: string): Promise<void> {
  await ensureEmailSearchIndex();
  const record = await prisma.emailJob.findUnique({ where: { id: emailJobId }, include: { campaign: { select: { userId: true } } } });
  if (!record) return;
  const document = asDocument(record);
  await getElasticsearchClient().update({
    index: EMAIL_SEARCH_INDEX, id: record.id, retry_on_conflict: 3,
    scripted_upsert: true, upsert: document,
    script: { lang: "painless", source: monotonicUpdateScript, params: { doc: document } },
  });
}

export async function indexEmailJobs(records: Parameters<typeof asDocument>[0][]): Promise<number> {
  if (records.length === 0) return 0;
  await ensureEmailSearchIndex();
  const operations = records.flatMap((record) => {
    const document = asDocument(record);
    return [
      { update: { _index: EMAIL_SEARCH_INDEX, _id: record.id, retry_on_conflict: 3 } },
      { scripted_upsert: true, upsert: document, script: { lang: "painless" as const, source: monotonicUpdateScript, params: { doc: document } } },
    ];
  });
  const result = await getElasticsearchClient().bulk({ operations, refresh: false });
  if (result.errors) {
    const reason = result.items.find((item) => item.update?.error)?.update?.error?.reason;
    throw new Error(`Elasticsearch bulk indexing failed: ${reason ?? "unknown bulk error"}`);
  }
  return records.length;
}
