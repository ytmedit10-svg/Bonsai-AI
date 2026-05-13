# Retrieval And Context Architecture Plan

Last updated: 2026-05-06

This plan describes how Node-based Chat should evolve from a branching chat app with durable memory into a retrieval-aware AI workspace. The goal is not to add a separate vector database early. The goal is to build a clear retrieval stack:

**structured app DB + search index + semantic retrieval + context builder + citations/inspectability**

Postgres remains the source of truth. Full-text search and later `pgvector` provide retrieval. The context builder decides what enters the model prompt. The inspector shows users and developers why each item was included.

---

## 1. Structured App DB

Goal: keep durable product state in normalized Postgres tables, with clear provenance for every memory-like object.

### Current Sources Of Truth

- `conversations`
- `paths`
- `messages`
- `path_snapshots`
- `memory_artifacts`
- `merges`
- `attachments`
- `model_runs`
- `jobs`
- `cache_records`

### Design Rules

- Messages are never deleted or rewritten for compaction.
- Memory artifacts should point back to source messages, paths, merges, or attachments where possible.
- Context selection should record source IDs, not just copied text.
- Every generated answer should be traceable back to:
  - model run
  - context bundle
  - source path
  - source messages/artifacts
  - provider/model

### Implementation Tracker

- [x] Store messages, branches, snapshots, memory artifacts, merges, model runs, jobs, and attachments in Postgres.
- [x] Preserve original messages when compaction runs.
- [x] Record context bundle summaries in `model_runs.requestPayloadJson`.
- [x] Store regeneration lineage in assistant message metadata.
- [x] Add explicit citation/source metadata shape for generated assistant messages.
- [x] Add source reference helpers shared by context builder, citations, and inspector.
- [x] Add migration or JSON conventions for `contentJson.sources` on assistant messages.

### Acceptance Criteria

- [x] A generated answer can expose the source IDs used to produce it.
- [x] A developer can trace answer -> model run -> context bundle -> source records.
- [x] Memory artifacts have enough metadata to explain their origin.

---

## 2. Search Index

Goal: users and services can find relevant text across conversations, paths, messages, memories, merges, and attachment metadata.

### First Pass: Postgres Full-Text Search

Use Postgres full-text search before embeddings. This should support exact and lexical discovery without additional infrastructure.

Searchable sources:

- conversation titles
- path titles
- message text
- path snapshot text
- memory artifact text
- merge artifact text
- attachment names and metadata

### Proposed API

- `GET /search?q=...`
- Optional filters:
  - `conversationId`
  - `pathId`
  - `sourceType`
  - `limit`

### Result Shape

Each result should include:

- `sourceType`
- `sourceId`
- `conversationId`
- `pathId`
- `title`
- `snippet`
- `rank`
- `createdAt`

### Implementation Tracker

- [x] Add generated `tsvector` columns or expression indexes.
- [x] Add indexes for messages, paths, conversations, snapshots, memory artifacts, and attachments.
- [x] Add `search-service.ts`.
- [x] Add `GET /search?q=...`.
- [x] Return typed results with snippets.
- [x] Add result navigation to conversation/path/message.
- [x] Add lightweight UI search panel or command palette.

### Acceptance Criteria

- [x] User can search text across all conversations.
- [x] Results jump to the relevant path/message/artifact.
- [x] Search results distinguish source types.
- [x] Search works without calling an AI provider.

---

## 3. Semantic Retrieval

Goal: retrieve conceptually relevant memories and artifacts when exact keyword search is not enough.

### Recommended Approach

Start with Postgres, not a separate vector database. The current local stack uses
durable `embedding_records` plus deterministic local embeddings so the hackathon
demo runs without another provider. If the local Postgres install adds
`pgvector`, `embedding_json` can be mirrored into a native `vector` column for
ANN indexes without changing source IDs, context policy, or citations.

Add a dedicated retrieval table rather than sprinkling embedding columns across every source table.

### Proposed Table: `embedding_records`

Fields:

- `id`
- `sourceType`
- `sourceId`
- `conversationId`
- `pathId`
- `visibility`
- `contentText`
- `contentHash`
- `embeddingModel`
- `embedding`
- `tokenEstimate`
- `metadataJson`
- `createdAt`
- `updatedAt`

Recommended `sourceType` values:

- `message`
- `path_snapshot`
- `memory_artifact`
- `merge_artifact`
- `attachment_text`

### Retrieval Policy

Semantic retrieval should be scoped before ranking:

1. Same active path.
2. Same conversation.
3. Related branch family/root path.
4. Shared conversation-level memory.
5. Optional global/user memory later.

Do not retrieve arbitrary global content by default.

### Background Jobs

Embedding should be asynchronous:

- enqueue embedding job when a message/artifact/attachment text is created
- skip if content hash already embedded
- re-embed if source text or embedding model changes

### Implementation Tracker

- [x] Document pgvector upgrade path for local Postgres.
- [x] Add `embedding_records` schema and migration.
- [x] Add embedding provider adapter.
- [x] Add embedding job type.
- [x] Add source extraction for messages, memory artifacts, snapshots, merge artifacts, and attachment text.
- [x] Add semantic retrieval service.
- [x] Add hybrid retrieval service combining full-text and semantic results.
- [x] Add replay fixture for deterministic retrieval behavior using mock/local embeddings.

### Acceptance Criteria

- [x] Relevant older memories can be retrieved without exact keyword match.
- [x] Semantic retrieval respects conversation/path visibility.
- [x] Embeddings are generated asynchronously and idempotently.
- [x] Retrieval decisions are recorded in model run metadata.

---

## 4. Context Builder

Goal: every model call should be assembled from a deliberate, inspectable context plan.

### Existing Foundation

The app already has `context-budget-service.ts` and a `ContextBundle` concept covering:

- system instruction
- active compaction
- branch snapshot
- merge memories
- recent messages
- attachments
- dropped items
- token estimates
- cache candidates

### Target Context Order

For normal chat:

1. System/developer instruction.
2. Active path compaction.
3. Branch snapshot.
4. Relevant merge memories.
5. Retrieved memories/search results.
6. Attachment summaries or extracted text.
7. Recent raw messages.
8. Current user message.

### Context Budget Rules

- Prefer recent path messages over broad retrieval.
- Prefer active compaction over older raw messages.
- Prefer source diversity over many near-duplicate search hits.
- Drop low-rank retrieval before dropping branch snapshot or active compaction.
- Always record dropped items.

### Implementation Tracker

- [x] Add context budget service.
- [x] Include compaction, branch snapshot, merge memories, recent messages, dropped items, token estimates.
- [x] Record context metadata in model runs.
- [x] Add full-text retrieval candidates to context builder.
- [x] Add semantic retrieval candidates to context builder.
- [x] Add dedupe/rerank step across memory/search/vector candidates.
- [x] Add source reference objects to every context item.
- [x] Add deterministic replay tests for context selection.

### Acceptance Criteria

- [x] Every model call has an inspectable context plan.
- [x] Context includes retrieval only when relevant and within budget.
- [x] Dropped retrieval candidates are recorded with reasons.
- [x] Provider adapters only translate prepared context, not decide app-level memory policy.

---

## 5. Citations

Goal: generated answers can point back to the app records that influenced them.

### Citation Types

Start with app-internal citations, not academic-style citations.

Citation source types:

- message
- branch snapshot
- compacted memory
- merge memory
- attachment
- search result

### Assistant Message Metadata

Store citation/source metadata in `messages.contentJson`, for example:

```json
{
  "sources": [
    {
      "sourceType": "memory_artifact",
      "sourceId": "uuid",
      "pathId": "uuid",
      "conversationId": "uuid",
      "label": "Compacted memory",
      "snippet": "Short human-readable excerpt"
    }
  ]
}
```

This does not require the model to produce perfect inline citations at first. The app can show “context used” citations based on the context bundle.

### Phases

1. **Context citations**
   Show what sources were included in the prompt.

2. **Inline citations**
   Ask the model to cite specific source labels like `[M1]`, `[S2]`, `[A1]`.

3. **Citation verification**
   Validate that cited labels exist and map to included sources.

### Implementation Tracker

- [x] Define shared `SourceReference` type.
- [x] Add source references to `ContextBundle` items.
- [x] Store source references in assistant `contentJson.sources`.
- [x] Add UI source chips below assistant messages.
- [x] Add source preview drawer/panel.
- [x] Add optional inline citation prompt format.
- [x] Add citation validation in replay harness.

### Acceptance Criteria

- [x] User can see which app records influenced an answer.
- [x] Clicking a source jumps to or previews the source record.
- [x] Citations never claim sources that were not included in context.

---

## 6. Inspectability

Goal: users and developers can answer “why did the model remember that?”

### Inspector Views

Path-level inspector:

- active compaction
- branch snapshot
- merge memories
- recent messages
- retrieval candidates
- dropped context
- token estimates
- cache status

Run-level inspector:

- exact context bundle summary
- provider/model
- source references
- dropped items
- prompt cache candidates
- usage/cost/latency
- errors/fallbacks

Message-level inspector:

- producing model run
- visible variant lineage
- context diff between variants
- citations/source references

### Implementation Tracker

- [x] Add context preview endpoint for path-level context.
- [x] Add model run observability.
- [x] Add regeneration lineage and context diff.
- [x] Add run-level context endpoint or richer run payload view.
- [x] Add source/citation preview UI.
- [x] Add retrieval candidate and dropped retrieval display.
- [x] Add source chain view for why memory/retrieval was included.

### Acceptance Criteria

- [x] User can inspect what memory/search/retrieval was used.
- [x] Developer can debug missing or wrong context from a failed answer.
- [x] Retrieval is visible enough to tune safely.

---

## 7. Implementation Phases

### Phase 1: Postgres Search

- [x] Add full-text indexes.
- [x] Add search service and `GET /search`.
- [x] Add simple UI search.
- [x] Add result navigation.

### Phase 2: Source References

- [x] Define `SourceReference`.
- [x] Add source refs to context bundle items.
- [x] Persist source refs on assistant messages.
- [x] Show source chips under answers.

### Phase 3: Semantic Retrieval With `pgvector`

- [x] Add Postgres-backed embeddings.
- [x] Add `embedding_records`.
- [x] Add embedding jobs.
- [x] Add semantic retrieval service.
- [x] Add hybrid lexical + semantic retrieval.

### Phase 4: Inspector Upgrade

- [x] Show retrieval candidates.
- [x] Show dropped retrieval candidates.
- [x] Add source chain view for why memory/retrieval was included.
- [x] Add run-level context inspection.

### Phase 5: Replay And Eval Coverage

- [x] Add search fixture.
- [x] Add semantic retrieval fixture with mock embeddings.
- [x] Add citation fixture.
- [x] Add attachment retrieval fixture.

---

## Recommended Near-Term Decision

For the Gemma 4 hackathon:

- Keep Postgres as the only database.
- Add full-text search only if needed for demo navigation.
- Do not add external vector DB.
- Add `pgvector` later when semantic retrieval becomes necessary.
- Prioritize source references and inspectability before fancy retrieval.

The strongest demo story is: the app knows what context it used, can show it, and can replay it.

