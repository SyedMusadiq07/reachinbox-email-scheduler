import { EMAIL_SEARCH_INDEX, getElasticsearchClient } from "./elasticsearch.js";

export interface EmailSearchOptions { userId: string; q: string; status?: string; page: number; pageSize: number; }

export async function searchEmails(options: EmailSearchOptions): Promise<{
  items: Array<{ id: string; recipientEmail: string; subject: string; status: string; scheduledAt: string; sentAt: string | null }>;
  total: number; page: number; pageSize: number;
}> {
  const clauses = options.q.includes("@")
    ? [{ term: { recipientEmail: { value: options.q, case_insensitive: true } } }]
    : [{ multi_match: { query: options.q, fields: ["subject^2", "body", "recipientEmail.search"] } }];
  const result = await getElasticsearchClient().search({
    index: EMAIL_SEARCH_INDEX,
    from: (options.page - 1) * options.pageSize,
    size: options.pageSize,
    track_total_hits: true,
    query: { bool: {
      filter: [
        { term: { userId: options.userId } },
        ...(options.status ? [{ term: { status: options.status } }] : []),
      ],
      must: clauses,
    } },
    sort: [{ scheduledAt: "desc" }, { id: "asc" }],
  });
  const total = typeof result.hits.total === "number" ? result.hits.total : result.hits.total?.value ?? 0;
  const items = result.hits.hits.map((hit) => {
    const source = hit._source as { id: string; recipientEmail: string; subject: string; status: string; scheduledAt: string; sentAt: string | null };
    return { id: source.id, recipientEmail: source.recipientEmail, subject: source.subject, status: source.status, scheduledAt: source.scheduledAt, sentAt: source.sentAt };
  });
  return { items, total, page: options.page, pageSize: options.pageSize };
}
