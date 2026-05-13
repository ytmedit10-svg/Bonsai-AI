# Essential App Roadmap

Last updated: 2026-05-06

This document tracks the 10 essential systems needed for Node-based Chat to feel like a serious branching AI workspace rather than a normal chat UI with branches attached. Each section includes architectural decisions, implementation work, progress state, and acceptance criteria.

## Current Baseline

- The app has branching paths, split snapshots, merge summaries, model run observability, Gemini/Groq provider adapters, streaming chat, and image attachment previews.
- Prompt caching exists for Gemini split snapshots only. It is implemented in `apps/api/src/services/cache-service.ts` and invoked from `apps/api/src/services/gemini-adapter.ts` when `inheritedSnapshotText` is present.
- Prompt caching does not currently cover normal main-path chat, rolling compacted summaries, merge contexts, document bundles, or Groq.
- Automatic path-scoped compaction now exists as an in-process post-response task. It stores active `path_compaction` artifacts in `memory_artifacts`, keeps original messages untouched, and feeds active compaction back into future generation for that same path only.
- Compaction is not yet backed by a durable background job runner, manual debug route, or replay/eval fixtures.

## Status Legend

- [ ] Not started
- [~] In progress
- [x] Done

## Priority Stack

1. Real compaction
2. Context budget manager
3. Memory/context inspector
4. Attachment storage upgrade
5. Regeneration lineage
6. Background jobs
7. Model/provider controls
8. Search across conversations
9. Resilience UX
10. Eval/replay harness

The first three should be built together because they share the same context-building architecture.

---

## 1. Real Compaction

Goal: automatically compress older path history into durable memory while keeping recent turns raw.

### Architectural Decisions

- Store compacted path memory as `memory_artifacts` with `artifactType = path_compaction`.
- Keep `path_snapshots` for branch inheritance snapshots. Do not overload snapshots with rolling compaction.
- Use `memory_artifacts.contentJson` for cursor metadata:
  - `coveredMessageStartSequenceNo`
  - `coveredMessageEndSequenceNo`
  - `sourceMessageIds`
  - `summaryVersion`
  - `tokenEstimate`
  - `modelProvider`
  - `modelName`
- Generation should use: system prompt, active compacted memory, branch snapshot if any, merge memories if relevant, then recent raw messages.
- Compaction must never delete messages. It only changes what is sent to the model.
- Compaction should be idempotent for a path and message range.

### Implementation Tracker

- [x] Add compaction artifact schema conventions in shared types or API-local constants.
- [x] Add `compaction-service.ts`.
- [x] Add AI adapter method `generatePathCompaction`.
- [x] Add Gemini compaction prompt.
- [x] Add Groq compaction prompt.
- [x] Add service to choose eligible message ranges.
- [x] Add transaction to write `path_compaction` memory artifact.
- [x] Add generation support to include latest active compaction.
- [x] Add admin/debug route to manually compact a path.
- [x] Add automatic compaction trigger after successful assistant response.
- [ ] Add tests or replay fixtures for compacting long paths.

### Acceptance Criteria

- [x] A path with more than the configured raw message window gets a compacted memory artifact.
- [x] Future runs include the compacted summary plus recent messages.
- [x] The original transcript remains fully visible in the UI.
- [x] Regeneration can still rebuild context from the same compaction artifact when the regenerated message is after the compaction cursor.
- [x] Model runs record whether compaction was included.

---

## 2. Context Budget Manager

Goal: every model call should be built from a deliberate, observable context plan.

Status: implemented for chat, streaming chat, and regeneration through `context-budget-service.ts`. The manager now owns path-scoped memory selection, recent-message windowing, token estimates, cache-candidate metadata, dropped-item metadata, and a read-only context preview endpoint.

### Architectural Decisions

- Create one API service responsible for generation context assembly: `context-budget-service.ts`.
- Stop assembling `history` directly in route handlers.
- Introduce a `ContextBundle` type:
  - `systemInstruction`
  - `activeCompaction`
  - `branchSnapshot`
  - `mergeMemories`
  - `recentMessages`
  - `attachments`
  - `droppedItems`
  - `estimatedTokens`
  - `cacheCandidates`
- Token estimates can start with the current rough `chars / 4` approach, but the service should isolate token counting so it can be replaced later.
- Context building should be provider-aware because Gemini cached content and Groq plain messages have different shapes.

### Implementation Tracker

- [x] Define `ContextBundle` and `ContextBudgetPolicy`.
- [x] Move recent-message loading out of route handlers into the context builder.
- [x] Include path compaction artifacts when available.
- [x] Include branch snapshots when available.
- [x] Include merge memories using a bounded relevance rule.
- [x] Add token estimate and max-context configuration.
- [x] Add deterministic trimming order.
- [x] Record context bundle metadata in `model_runs.requestPayloadJson`.
- [x] Expose context bundle summaries to the inspector UI through `GET /paths/:pathId/context`.

### Acceptance Criteria

- [x] Every chat, stream, and regenerate call has a recorded context plan.
- [ ] Merge calls still use merge-specific context assembly.
- [x] Large conversations do not silently drop important context without recording what was dropped.
- [x] Prompt cache candidates are surfaced from the bundle; provider-specific cache creation still lives in the Gemini adapter.

---

## 3. Memory And Context Inspector

Goal: users should be able to inspect what the model is using as memory.

### Architectural Decisions

- Build this as a path-level panel in the web app, not as an admin-only tool.
- Use read-only API endpoints first. Editing memory can come later.
- Show human-friendly labels:
  - Recent messages
  - Branch snapshot
  - Compacted memory
  - Merge memory
  - Cached prefix
  - Dropped context
- Link every memory item back to its source messages/artifacts where possible.

### Implementation Tracker

- [ ] Add API route `GET /paths/:pathId/context`.
- [ ] Return the latest `ContextBundle` preview without invoking a model.
- [ ] Add API route `GET /model-runs/:runId/context` or embed enough context metadata in existing observability routes.
- [ ] Add web panel or drawer for "Context".
- [ ] Add compact cards for each memory source.
- [ ] Add token estimate display.
- [ ] Add cache status display.
- [ ] Add source message links or jump behavior.

### Acceptance Criteria

- User can answer: "Why did the model remember that?"
- User can see when compaction or cache was used.
- User can distinguish inherited branch memory from current path messages.

---

## 4. Attachment Storage Upgrade

Goal: move attachments from message JSON/data URLs toward real storage references.

Status: implemented with Cloudflare R2 as the storage backend. Messages now carry attachment metadata and API content URLs instead of embedded image data. Original files are stored in R2 and tracked in Postgres through the `attachments` table.

### Architectural Decisions

- Add an `attachments` table rather than storing large file data in `messages.contentJson`.
- Use Cloudflare R2 through the S3-compatible API as the primary storage backend.
- `messages.contentJson.attachments` should reference attachment IDs and lightweight metadata only.
- Generate thumbnails for images later; current implementation reuses the original image URL as the preview URL.
- Keep current data URL composer preview only as a client-side pre-upload preview.
- Enforce per-file and per-message size limits server-side.

### Implementation Tracker

- [x] Add `attachments` table.
- [x] Add migration.
- [x] Add upload route with mime validation.
- [x] Add R2 storage service.
- [ ] Add thumbnail generation for images.
- [x] Update composer to upload before message creation.
- [x] Store attachment references in message JSON.
- [x] Add secure attachment serving route.
- [x] Add cleanup behavior for orphaned uploads.
- [x] Add UI loading/error states for upload failure.

### Acceptance Criteria

- [x] Large images no longer inflate message rows.
- [x] Click-to-preview still works through API-served R2 objects.
- [x] Attachments survive reloads and sharing for the owning user.
- [x] Invalid file types and oversized files are rejected clearly.

---

## 5. Regeneration Lineage

Goal: regenerated answers and edited prompts should preserve their exact ancestry.

Status: implemented for assistant regeneration. Regenerated assistant messages now keep a variant lineage in `messages.contentJson.lineage`, store the producing `modelRunId`, source user message, model identity, and context bundle summary for each generated variant, and expose a UI control for switching between variants.

### Architectural Decisions

- Treat regeneration as appending a new assistant message variant inside the existing message record. This keeps branch/message references stable while preserving previous answers.
- Add lineage metadata:
  - `sourceUserMessageId`
  - `regeneratedFromMessageId`
  - `contextBundle`
  - `modelRunId`
  - `variantNo`
- Use `messages.contentJson.lineage` for the first pass. Prefer a dedicated `message_variants` table later if variant counts grow, variant diffing becomes heavy, or variants need independent permissions/audit rows.
- Regeneration should preserve the exact context bundle used for the new run in `model_runs`.
- Selecting a variant updates the visible assistant message content and `lineage.currentVariantNo`; the full variant list remains intact.

### Implementation Tracker

- [x] Define lineage metadata shape.
- [x] Update regenerate route to write lineage.
- [x] Preserve old assistant content as variant 1 before appending regenerated variants.
- [x] Add API route for selecting the active assistant variant.
- [x] Add UI for switching variants.
- [x] Add context diff between variants.
- [x] Include lineage in shared conversation rendering.
- [x] Add tests for edit/regenerate/branch interactions.

### Acceptance Criteria

- [x] User can switch answer variants.
- [x] A branch from a regenerated answer keeps the same message identity and uses the currently selected visible content.
- [x] Observability can trace answer -> run -> context -> model through lineage metadata and model run payloads.
- [x] User can see a compact context diff between variants.

---

## 6. Background Jobs

Goal: slow or repeatable work should not live inside request handlers.

Status: implemented with Postgres-backed jobs. The app now has a durable `jobs` table, a worker entrypoint, job enqueue/claim/complete/fail helpers, queued path compaction, queued attachment cleanup, and worker-driven cache expiry. No Redis or external queue service is required.

### Architectural Decisions

- Start with a database-backed job table before adding Redis or a queue service.
- Add `jobs` table:
  - `jobType`
  - `status`
  - `payloadJson`
  - `attempts`
  - `maxAttempts`
  - `runAfter`
  - `lockedAt`
  - `completedAt`
  - `errorText`
- Run worker with `npm run dev:worker` locally.
- Deploy the worker as a second process using the same API package/image with `npm run worker`.
- Use Postgres row locks with `FOR UPDATE SKIP LOCKED` so multiple workers can safely claim jobs.
- Use `dedupeKey` to avoid piling up duplicate queued/running maintenance or path-compaction jobs.
- Candidate job types:
  - `path_compaction`
  - `cache_expiry`
  - `title_refresh`
  - `attachment_cleanup`
  - `embedding_index`
  - `merge_generation`
- Request handlers can enqueue and return pending state for long tasks.

### Implementation Tracker

- [x] Add `jobs` table and migration.
- [x] Add job service with enqueue, claim, complete, fail.
- [x] Add worker package entrypoint under `apps/api/src/worker.ts`.
- [x] Add `npm run dev:worker` and production `npm run worker`.
- [x] Move cache expiry to job/worker.
- [x] Move automatic compaction to job/worker.
- [x] Move attachment cleanup to job/worker.
- [x] Add retry policy and terminal failed state.
- [x] Add admin observability for job queue.

### Acceptance Criteria

- [x] Compaction can run after a response without delaying chat completion.
- [x] Failed background jobs are visible in `GET /admin/jobs`.
- [x] Cache expiry runs through the worker maintenance loop.
- [x] Orphaned upload cleanup runs through queued jobs instead of inside admin requests.

---

## 7. Model And Provider Controls

Goal: users and operators should know which model is active and control it safely.

### Architectural Decisions

- Keep environment defaults, but add runtime profile visibility.
- Validate configured model availability at startup or via health endpoint.
- Store provider/model per run, already partly done in `model_runs` and messages.
- Add model capability metadata:
  - streaming
  - web search
  - prompt caching
  - max context
  - supports attachments
- Avoid silent fallback unless recorded and shown to the user.

### Implementation Tracker

- [ ] Add `GET /ai/profile` with active provider, models, and capabilities.
- [ ] Add startup or health check model validation.
- [ ] Add UI model indicator.
- [ ] Add per-run model selector.
- [ ] Add disabled states for unsupported features like web search on Groq.
- [ ] Record fallback provider/model in run metadata.
- [ ] Add user-facing fallback notice.

### Acceptance Criteria

- User can see why a run used Gemma, Gemini, Groq, or a fallback.
- Invalid model config is caught before a chat fails mysteriously.
- Feature toggles reflect provider capability.

---

## 8. Search Across Conversations

Goal: users should be able to find messages, branches, summaries, and artifacts.

### Architectural Decisions

- Start with Postgres full-text search before adding embeddings.
- Search sources:
  - conversations
  - paths
  - messages
  - memory artifacts
  - merge artifacts
  - attachment metadata
- Add a unified search endpoint returning typed results.
- Later add semantic search via embeddings, probably as a background-indexed table.

### Implementation Tracker

- [ ] Add full-text indexes or generated search vectors.
- [ ] Add search service.
- [ ] Add `GET /search?q=...`.
- [ ] Return typed result snippets with path/conversation references.
- [ ] Add web search UI.
- [ ] Add keyboard shortcut for search.
- [ ] Add result navigation to message/path.
- [ ] Add optional background embedding index design.

### Acceptance Criteria

- User can search for text across all conversations.
- Results can jump directly to the relevant path/message.
- Summaries and merge artifacts are discoverable.

---

## 9. Resilience UX

Goal: failures should be recoverable and understandable.

### Architectural Decisions

- Store partial streamed assistant text if a stream fails after emitting content.
- Standardize API error shapes.
- Preserve the failed run and allow retry from the same context bundle.
- Distinguish provider errors, validation errors, network failures, and app bugs.
- UI should show recovery actions near the failed message.

### Implementation Tracker

- [x] Standardize error response schema.
- [x] Add stream failure persistence for partial text.
- [x] Add failed assistant placeholder message or run marker.
- [x] Add retry from same context.
- [x] Add retry with updated context.
- [x] Add provider-specific error normalization.
- [x] Add user-facing error copy for common failures.
- [x] Add UI actions: retry, copy error, inspect run.

### Acceptance Criteria

- [x] A failed stream does not lose useful partial output.
- [x] User can retry without retyping.
- [x] Internal errors surface enough information for debugging without leaking secrets.

---

## 10. Eval And Replay Harness

Goal: core AI workflows need repeatable verification.

Status: minimal replay harness implemented for the core hackathon workflow. It uses
`AI_PROVIDER=mock`, local fixtures, real API routes, structural assertions, and no
live provider calls.

### Architectural Decisions

- Keep eval fixtures local and deterministic first.
- Mock provider responses for CI-style checks.
- Add optional live eval mode gated by env vars.
- Cover workflows, not just units:
  - create conversation
  - send message
  - stream response
  - create branch
  - compact path
  - merge branch
  - regenerate answer
  - attach image
- Record expected structural outcomes instead of exact prose where possible.

### Implementation Tracker

- [x] Add fixture format for conversations and paths.
- [x] Add mock AI adapter.
- [x] Add replay runner script.
- [x] Add assertions for context bundles.
- [x] Add assertions for compaction artifacts.
- [x] Add assertions for merge artifacts.
- [ ] Add attachment workflow fixture.
- [x] Add `npm run eval:replay`.
- [x] Document how to add new fixtures.

### Acceptance Criteria

- [x] A developer can replay core workflows locally.
- [x] Compaction and branching can be verified without calling external AI.
- [x] Live provider changes can be tested intentionally, not accidentally.

---

## Cross-Cutting Architecture Decisions

### Context Is A Product Surface

The app should treat model context as first-class data. Users should be able to inspect it, and developers should be able to replay it.

### Memory Is Additive

Do not delete or rewrite user-visible messages for memory management. Compaction, snapshots, and merge memories should be additive artifacts that change future context assembly.

### Provider Adapters Stay Thin

Provider adapters should translate a prepared context bundle into provider-specific request shapes. They should not decide which app-level memories matter.

### Route Handlers Stay Thin

Routes should validate input, call services, stream or return responses, and record model runs. They should not contain context assembly, compaction decisions, or provider policy.

### Observability Is Mandatory

Every model run should record enough metadata to answer:

- What model was used?
- What memory was included?
- What was omitted and why?
- Was prompt caching used?
- How many tokens were estimated and reported?
- Which run produced this visible message?

---

## Suggested Milestones

### Milestone 1: Context Core

- [x] Implement context builder.
- [x] Record context bundle metadata on model runs.
- [x] Add path context inspector endpoint.
- [ ] Add minimal UI inspector.

### Milestone 2: Compaction

- [x] Add compaction service.
- [x] Add manual compaction route.
- [x] Add compaction memory artifacts.
- [x] Include compaction in generation.
- [x] Add automatic compaction trigger.

### Milestone 3: Storage And Reliability

- [x] Add attachment table and upload flow.
- [x] Add background job runner.
- [x] Move cache expiry and compaction to jobs.
- [ ] Improve stream failure recovery.

### Milestone 4: Power User Layer

- [ ] Add model controls.
- [ ] Add search.
- [x] Add regeneration variants.
- [ ] Add replay/eval harness.

---

## Open Questions

- Should compaction happen synchronously after every N messages, or asynchronously when the model run completes?
- Should users be allowed to edit compacted memory, or only inspect and regenerate it?
- Should merge memories automatically influence target paths, or only appear as visible assistant messages?
- Should prompt caching expand to compacted memory and merge contexts once the context builder exists?
- What is the first storage backend for attachments beyond local disk?
- Should semantic search wait until the full-text search implementation proves its shape?
