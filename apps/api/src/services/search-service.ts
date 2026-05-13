import { sql } from "drizzle-orm";

import { db } from "../db/client.js";

type SearchInput = {
  conversationId?: string;
  limit: number;
  pathId?: string;
  query: string;
  sourceType?: SearchResult["sourceType"];
  userId: string;
};

export type SearchResult = {
  conversationId: string;
  createdAt: string;
  pathId: string | null;
  rank: number;
  snippet: string;
  sourceId: string;
  sourceType:
    | "attachment"
    | "conversation"
    | "memory_artifact"
    | "message"
    | "path"
    | "path_snapshot";
  title: string;
};

type SearchRow = Omit<SearchResult, "createdAt" | "rank"> & {
  createdAt: Date | string;
  rank: string | number;
};

const SNIPPET_LIMIT = 220;

const toSnippet = (value: string) => {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= SNIPPET_LIMIT) {
    return normalized;
  }

  return `${normalized.slice(0, SNIPPET_LIMIT - 3).trimEnd()}...`;
};

const toSearchResult = (row: SearchRow): SearchResult => ({
  conversationId: row.conversationId,
  createdAt:
    row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  pathId: row.pathId,
  rank: Number(row.rank),
  snippet: toSnippet(row.snippet),
  sourceId: row.sourceId,
  sourceType: row.sourceType,
  title: row.title
});

export const searchWorkspace = async ({
  conversationId,
  limit,
  pathId,
  query,
  sourceType,
  userId
}: SearchInput) => {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return [];
  }

  const result = await db.execute<SearchRow>(sql`
    with search_query as (
      select websearch_to_tsquery('english', ${normalizedQuery}) as query
    ),
    ranked_results as (
      select
        'conversation'::text as "sourceType",
        c.id::text as "sourceId",
        c.id::text as "conversationId",
        c.main_path_id::text as "pathId",
        c.title as "title",
        c.title as "snippet",
        c.created_at as "createdAt",
        ts_rank_cd(to_tsvector('english', coalesce(c.title, '')), sq.query) as "rank"
      from conversations c
      cross join search_query sq
      where
        c.user_id = ${userId}
        and c.status = 'active'
        and (${conversationId ?? null}::uuid is null or c.id = ${conversationId ?? null}::uuid)
        and (${pathId ?? null}::uuid is null or c.main_path_id = ${pathId ?? null}::uuid)
        and to_tsvector('english', coalesce(c.title, '')) @@ sq.query

      union all

      select
        'path'::text as "sourceType",
        p.id::text as "sourceId",
        p.conversation_id::text as "conversationId",
        p.id::text as "pathId",
        p.title as "title",
        concat_ws(' ', p.title, p.split_focus_text) as "snippet",
        p.created_at as "createdAt",
        ts_rank_cd(
          to_tsvector('english', coalesce(p.title, '') || ' ' || coalesce(p.split_focus_text, '')),
          sq.query
        ) as "rank"
      from paths p
      inner join conversations c on c.id = p.conversation_id
      cross join search_query sq
      where
        c.user_id = ${userId}
        and c.status = 'active'
        and (${conversationId ?? null}::uuid is null or p.conversation_id = ${conversationId ?? null}::uuid)
        and (${pathId ?? null}::uuid is null or p.id = ${pathId ?? null}::uuid)
        and to_tsvector('english', coalesce(p.title, '') || ' ' || coalesce(p.split_focus_text, '')) @@ sq.query

      union all

      select
        'message'::text as "sourceType",
        m.id::text as "sourceId",
        m.conversation_id::text as "conversationId",
        m.path_id::text as "pathId",
        concat(m.role, ' message') as "title",
        m.content_text as "snippet",
        m.created_at as "createdAt",
        ts_rank_cd(to_tsvector('english', coalesce(m.content_text, '')), sq.query) as "rank"
      from messages m
      inner join conversations c on c.id = m.conversation_id
      cross join search_query sq
      where
        c.user_id = ${userId}
        and c.status = 'active'
        and (${conversationId ?? null}::uuid is null or m.conversation_id = ${conversationId ?? null}::uuid)
        and (${pathId ?? null}::uuid is null or m.path_id = ${pathId ?? null}::uuid)
        and to_tsvector('english', coalesce(m.content_text, '')) @@ sq.query

      union all

      select
        'path_snapshot'::text as "sourceType",
        ps.id::text as "sourceId",
        p.conversation_id::text as "conversationId",
        ps.path_id::text as "pathId",
        'Branch snapshot'::text as "title",
        ps.snapshot_text as "snippet",
        ps.created_at as "createdAt",
        ts_rank_cd(to_tsvector('english', coalesce(ps.snapshot_text, '')), sq.query) as "rank"
      from path_snapshots ps
      inner join paths p on p.id = ps.path_id
      inner join conversations c on c.id = p.conversation_id
      cross join search_query sq
      where
        c.user_id = ${userId}
        and c.status = 'active'
        and (${conversationId ?? null}::uuid is null or p.conversation_id = ${conversationId ?? null}::uuid)
        and (${pathId ?? null}::uuid is null or ps.path_id = ${pathId ?? null}::uuid)
        and to_tsvector('english', coalesce(ps.snapshot_text, '')) @@ sq.query

      union all

      select
        'memory_artifact'::text as "sourceType",
        ma.id::text as "sourceId",
        ma.conversation_id::text as "conversationId",
        ma.path_id::text as "pathId",
        replace(ma.artifact_type, '_', ' ') as "title",
        ma.content_text as "snippet",
        ma.created_at as "createdAt",
        ts_rank_cd(to_tsvector('english', coalesce(ma.content_text, '')), sq.query) as "rank"
      from memory_artifacts ma
      inner join conversations c on c.id = ma.conversation_id
      cross join search_query sq
      where
        c.user_id = ${userId}
        and c.status = 'active'
        and (${conversationId ?? null}::uuid is null or ma.conversation_id = ${conversationId ?? null}::uuid)
        and (${pathId ?? null}::uuid is null or ma.path_id = ${pathId ?? null}::uuid)
        and to_tsvector('english', coalesce(ma.content_text, '')) @@ sq.query

      union all

      select
        'attachment'::text as "sourceType",
        a.id::text as "sourceId",
        a.conversation_id::text as "conversationId",
        a.path_id::text as "pathId",
        a.original_name as "title",
        concat_ws(' ', a.original_name, a.mime_type, a.kind) as "snippet",
        a.created_at as "createdAt",
        ts_rank_cd(
          to_tsvector('english', coalesce(a.original_name, '') || ' ' || coalesce(a.mime_type, '') || ' ' || coalesce(a.kind, '')),
          sq.query
        ) as "rank"
      from attachments a
      inner join conversations c on c.id = a.conversation_id
      cross join search_query sq
      where
        c.user_id = ${userId}
        and c.status = 'active'
        and (${conversationId ?? null}::uuid is null or a.conversation_id = ${conversationId ?? null}::uuid)
        and (${pathId ?? null}::uuid is null or a.path_id = ${pathId ?? null}::uuid)
        and to_tsvector('english', coalesce(a.original_name, '') || ' ' || coalesce(a.mime_type, '') || ' ' || coalesce(a.kind, '')) @@ sq.query
    )
    select *
    from ranked_results
    where (${sourceType ?? null}::text is null or "sourceType" = ${sourceType ?? null}::text)
    order by "rank" desc, "createdAt" desc
    limit ${limit};
  `);

  return result.rows.map(toSearchResult);
};
