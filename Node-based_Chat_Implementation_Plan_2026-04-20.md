# Node-based Chat Low-level Implementation Plan

Date: 2026-04-20
Workspace: D:\Node-based chat
Depends on: Node-based_Chat_Product_Plan_2026-04-20.md

## Purpose

This document translates the high-level product plan into an implementation-ready plan for the MVP.

The goals of this document are:

- define the first technical architecture
- define the database schema in enough detail to build migrations
- define backend modules and API routes
- define frontend structure and key UI states
- define Gemini prompt assembly and caching behavior
- define the implementation sequence for the MVP

## Progress Tracker

Use this section as the live build tracker for the MVP.

Status values:

- `not started`
- `in progress`
- `blocked`
- `done`

### Tracker Table

| Milestone | Status | Dependencies | Notes | Next Action |
| --- | --- | --- | --- | --- |
| Project scaffold | `done` | None | npm workspace scaffold created with `apps/web`, `apps/api`, `packages/shared`, shared TypeScript config, `.env.example`, native PostgreSQL configuration, and verified `typecheck` and `build`. | Start database foundation with ORM selection, migrations, and base schema. |
| Database foundation | `done` | Project scaffold | Drizzle ORM selected and wired into the API app. Core schema created for `users`, `conversations`, `paths`, and `messages`, with generated SQL migration in `apps/api/drizzle`. Root database scripts added and repository still passes `typecheck` and `build`. Live migration apply depends on a running native PostgreSQL instance. | Start main chat flow with conversation creation, main path persistence, and Gemini streaming. |
| Main chat flow | `done` | Database foundation | Backend main chat flow includes conversation creation, automatic main-path creation, bootstrap-user setup, persisted path message read/write routes, Gemini-backed assistant generation, and an SSE streaming route. The frontend workspace now creates conversations, loads main-path history, sends messages, and consumes streaming assistant replies. Database migration and live backend request flow have been runtime-verified locally, and the full repo passes `typecheck` and `build`. | Start branching flow with split snapshots and branch creation endpoints. |
| Branching flow | `done` | Main chat flow | Branching now covers split snapshot persistence, branch creation from any path message, branch-local continuation, lineage-aware path switching, active-branch provenance, configurable branch setup, and a parent-vs-branch divergence view in the frontend. Merge behavior remains a separate milestone, but the standalone branch workflow is now complete for the MVP slice. | Start merge flow with lineage-aware merge requests and synthetic main-memory writes. |
| Merge flow | `done` | Branching flow | Merge flow now covers merge requests, persisted `merges` and `memory_artifacts`, synchronous Gemini-backed merge artifact generation, synthetic `merge_memory` writes onto main, conversation-level merge history, merge detail browsing, and visible merge markers in both branch and main-path UX. Local smoke testing confirmed merge creation plus successful history and detail fetch routes. | Start prompt caching with cache records, stable-prefix planning, and Gemini cache reuse rules. |
| Prompt caching | `in progress` | Main chat flow | Added `cache_records` persistence, cache planning service, Gemini split-snapshot explicit cache create/reuse flow, and env-driven thresholds/TTL controls with implicit fallback. | Apply migration in local DB, verify cache hit/reuse behavior in runtime logs, then extend caching to merge contexts and usage telemetry. |
| Frontend lineage UI | `done` | Branching flow | The workspace now includes a nested lineage tree, active-branch provenance, branch setup controls at the split point, and a parent-vs-branch comparison panel. Merge affordances will land with the merge milestone rather than this lineage milestone. | Reuse the branching UI foundation when merge actions are introduced. |
| Observability and cost tracking | `in progress` | Main chat flow | Implemented `model_runs` persistence, run lifecycle logging for chat and merge calls, admin observability APIs, and an Ops dashboard overlay in the web UI (admin key gated). | Apply migration, run end-to-end runtime smoke tests, and calibrate token/cost defaults per provider. |
| QA and polish | `not started` | Merge flow, Prompt caching, Frontend lineage UI | Finalize retry behavior, merge markers, branch titles, and test coverage. | Run manual QA scenarios and close top UX gaps. |

### Current Focus

Current recommended focus:

- `Prompt caching`

### Latest Update

- 2026-04-20: `Project scaffold` marked `done`.
- 2026-04-20: `Database foundation` marked `done` after Drizzle setup, core schema implementation, and initial migration generation.
- 2026-04-20: `Main chat flow` marked `in progress` as the next active milestone.
- 2026-04-20: `Main chat flow` gained conversation creation, main-path creation, and persisted message endpoints; Gemini streaming is the remaining step for milestone completion.
- 2026-04-20: `Main chat flow` gained backend Gemini generation and SSE streaming support; frontend consumption is the main remaining gap in this milestone.
- 2026-04-20: PostgreSQL database was created locally, migration applied successfully, API booted on port 4000, and both normal and streaming main-path message routes were exercised successfully against Gemini.
- 2026-04-20: `Main chat flow` marked `done` after the frontend workspace was wired to create conversations, render main-path history, send messages, and consume SSE assistant streaming from the API.
- 2026-04-20: `Branching flow` marked `in progress` as the next active milestone.
- 2026-04-20: `Branching flow` gained `path_snapshots`, branch creation, path switching, and frontend `Branch here` actions. Runtime verification confirmed branch creation and inherited snapshot storage; one branch continuation request hit a transient Gemini `503 UNAVAILABLE`, which is now surfaced cleanly instead of being collapsed into a generic server error.
- 2026-04-20: `Branching flow` gained a lineage-aware sidebar tree and active-branch split provenance. `Frontend lineage UI` moved to `in progress`; branch comparison and merge entry points are the next UX slice.
- 2026-04-20: `Branching flow` marked `done` after adding split-point branch setup controls and a parent-vs-branch divergence panel. `Frontend lineage UI` is also `done`, and the recommended focus moves to `Merge flow`.
- 2026-04-21: `Merge flow` marked `in progress` after adding `merges` and `memory_artifacts`, `POST /merges` and `GET /merges/:mergeId`, synchronous Gemini merge generation, synthetic `merge_memory` writes to main, and a branch-side merge panel in the frontend. Local smoke testing confirmed a completed merge and main-path memory write.
- 2026-04-21: `Merge flow` marked `done` after adding conversation-level merge history, merge detail browsing, lineage badges, and branch/main merge history panels. Runtime verification confirmed `POST /merges`, `GET /conversations/:conversationId/merges`, and `GET /merges/:mergeId` all succeeded in one local smoke run.
- 2026-04-23: `Prompt caching` marked `in progress` after implementing `cache_records`, a new cache planning service, and Gemini split-snapshot explicit cache reuse/create behavior with implicit fallback when cache is disabled, too small, unsupported, or creation fails.
- 2026-04-23: `Observability and cost tracking` marked `in progress` after implementing `model_runs` schema/service lifecycle logging, admin observability endpoints (`/admin/observability/summary`, `/admin/observability/runs`), and a gated Ops overlay in the web app for runtime metrics and recent run inspection.

### Update Rules

Whenever work is completed, update the tracker by:

- changing the milestone status
- adding a short note about what changed
- updating the next action to the immediate follow-up task

If a milestone is blocked, record:

- what is blocked
- why it is blocked
- what decision or dependency is required to unblock it

## MVP Assumptions

These assumptions keep the first build small and testable.

- single model provider: Gemini API
- primary model: Gemini 2.5 Flash
- no live audio, no multimodal generation, no autonomous agents
- no full freeform node canvas in v1
- one user can own many conversations
- each conversation has exactly one canonical main path
- branches can be created from main or from another branch
- merged output becomes part of main memory
- branch history is preserved in the MVP
- explicit prompt caching is used only for large stable prefixes

## Suggested Tech Stack

### Frontend

- React
- TypeScript
- Vite
- Tailwind CSS or a small design system
- Zustand or React context for view state
- SSE for model streaming in MVP

### Backend

- Node.js
- TypeScript
- Fastify
- Zod for request and response validation
- official Google GenAI SDK or direct Gemini REST wrapper

### Data

- PostgreSQL
- Drizzle ORM

### Async Jobs

- simple background worker process
- Redis only if queue pressure grows

## High-level Runtime Design

The system is split into three runtime zones:

- interactive API for normal reads and writes
- streaming inference pipeline for chat responses
- background task pipeline for merges, summaries, and cleanup

### Main Chat Request Lifecycle

1. Frontend posts a user message to a path.
2. Backend stores the user message in `messages`.
3. Backend creates a `model_runs` row with status `queued`.
4. Backend builds the active path context.
5. Backend checks explicit cache candidates.
6. Backend sends a Gemini request and streams tokens to the client.
7. Backend writes the assistant message.
8. Backend finalizes usage, cost, and cache metadata.

### Branch Creation Lifecycle

1. User clicks branch on a message.
2. Backend creates a new `paths` row.
3. Backend creates a `path_snapshots` row representing inherited memory at split time.
4. Backend optionally creates a cache candidate for the split snapshot if it is large enough.
5. Frontend adds the new branch to the lineage UI.

### Merge Lifecycle

1. User selects a branch and merge mode.
2. Backend creates a `merges` row with status `pending`.
3. Worker builds merge context from branch history plus inherited snapshot.
4. Worker calls Gemini to generate a merge artifact.
5. Worker stores the artifact in `memory_artifacts`.
6. Worker writes a synthetic main-path message referencing the merge.
7. Worker marks the merge `completed`.

## Proposed Repository Structure

This is a logical code layout, not a strict framework requirement.

```text
src/
  app/
    routes/
  components/
    chat/
    branches/
    lineage/
    merge/
  features/
    conversations/
    paths/
    messages/
    merges/
    streaming/
  server/
    api/
    db/
    services/
      conversation-service.ts
      path-service.ts
      message-service.ts
      context-assembler.ts
      gemini-adapter.ts
      cache-service.ts
      merge-service.ts
      usage-service.ts
    workers/
  lib/
    prompts/
    schemas/
    utils/
```

## Database Schema

Use UUID primary keys for all major tables.

### 1. users

Purpose:

- account ownership

Fields:

- `id` uuid primary key
- `email` text unique not null
- `name` text null
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()

### 2. conversations

Purpose:

- root container for one main path and all descendant branches

Fields:

- `id` uuid primary key
- `user_id` uuid not null references users(id)
- `title` text not null
- `status` text not null default 'active'
- `main_path_id` uuid null
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()

Indexes:

- `(user_id, updated_at desc)`

### 3. paths

Purpose:

- canonical main path and branch paths

Fields:

- `id` uuid primary key
- `conversation_id` uuid not null references conversations(id)
- `parent_path_id` uuid null references paths(id)
- `root_path_id` uuid not null references paths(id)
- `split_from_message_id` uuid null references messages(id)
- `split_from_artifact_id` uuid null references memory_artifacts(id)
- `path_type` text not null default 'chat'
- `is_main` boolean not null default false
- `title` text not null
- `depth` integer not null default 0
- `sort_order` integer not null default 0
- `status` text not null default 'active'
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()

Constraints:

- one `is_main = true` path per conversation

Indexes:

- `(conversation_id, created_at)`
- `(parent_path_id, created_at)`
- `(root_path_id, created_at)`

### 4. messages

Purpose:

- raw chat events inside a single path

Fields:

- `id` uuid primary key
- `conversation_id` uuid not null references conversations(id)
- `path_id` uuid not null references paths(id)
- `role` text not null
- `message_type` text not null default 'chat'
- `content_text` text not null
- `content_json` jsonb null
- `sequence_no` integer not null
- `created_by` text not null
- `source_merge_id` uuid null references merges(id)
- `source_artifact_id` uuid null references memory_artifacts(id)
- `model_provider` text null
- `model_name` text null
- `status` text not null default 'completed'
- `created_at` timestamptz not null default now()

Allowed `role` values:

- `system`
- `user`
- `assistant`
- `tool`

Allowed `message_type` values:

- `chat`
- `merge_memory`
- `system_note`

Indexes:

- `(path_id, sequence_no)`
- `(conversation_id, created_at)`

### 5. path_snapshots

Purpose:

- frozen inherited memory at the moment of branch creation

Fields:

- `id` uuid primary key
- `path_id` uuid not null references paths(id)
- `snapshot_kind` text not null default 'split_memory'
- `source_path_id` uuid not null references paths(id)
- `source_message_id` uuid null references messages(id)
- `version_no` integer not null default 1
- `snapshot_text` text not null
- `snapshot_json` jsonb null
- `token_estimate` integer null
- `cache_record_id` uuid null references cache_records(id)
- `created_at` timestamptz not null default now()

Indexes:

- `(path_id, version_no desc)`

### 6. memory_artifacts

Purpose:

- reusable compressed memory units, especially merges

Fields:

- `id` uuid primary key
- `conversation_id` uuid not null references conversations(id)
- `path_id` uuid not null references paths(id)
- `artifact_type` text not null
- `visibility` text not null default 'path'
- `content_text` text not null
- `content_json` jsonb null
- `origin_path_id` uuid null references paths(id)
- `origin_message_id` uuid null references messages(id)
- `origin_merge_id` uuid null references merges(id)
- `token_estimate` integer null
- `is_active` boolean not null default true
- `created_at` timestamptz not null default now()

Allowed `artifact_type` values:

- `merge_summary`
- `merge_full`
- `decision_block`
- `path_summary`
- `system_memory`

Indexes:

- `(path_id, created_at desc)`
- `(conversation_id, artifact_type, created_at desc)`

### 7. merges

Purpose:

- lineage-aware merge requests and results

Fields:

- `id` uuid primary key
- `conversation_id` uuid not null references conversations(id)
- `source_path_id` uuid not null references paths(id)
- `target_path_id` uuid not null references paths(id)
- `merge_mode` text not null
- `status` text not null default 'pending'
- `requested_by_user_id` uuid not null references users(id)
- `result_artifact_id` uuid null references memory_artifacts(id)
- `result_message_id` uuid null references messages(id)
- `error_text` text null
- `created_at` timestamptz not null default now()
- `completed_at` timestamptz null

Allowed `merge_mode` values:

- `light`
- `full`
- `reference`
- `collapse`

Indexes:

- `(source_path_id, created_at desc)`
- `(target_path_id, created_at desc)`
- `(status, created_at)`

### 8. model_runs

Purpose:

- operational log for Gemini requests

Fields:

- `id` uuid primary key
- `conversation_id` uuid not null references conversations(id)
- `path_id` uuid not null references paths(id)
- `message_id` uuid null references messages(id)
- `merge_id` uuid null references merges(id)
- `run_type` text not null
- `status` text not null default 'queued'
- `model_provider` text not null
- `model_name` text not null
- `cache_mode` text not null default 'none'
- `cache_record_id` uuid null references cache_records(id)
- `input_tokens` integer null
- `output_tokens` integer null
- `cached_tokens` integer null
- `estimated_cost_usd` numeric(12,6) null
- `latency_ms` integer null
- `request_payload_json` jsonb null
- `response_payload_json` jsonb null
- `error_text` text null
- `started_at` timestamptz null
- `completed_at` timestamptz null
- `created_at` timestamptz not null default now()

Allowed `run_type` values:

- `chat_response`
- `merge_generation`
- `summary_generation`

Indexes:

- `(path_id, created_at desc)`
- `(status, created_at)`

### 9. cache_records

Purpose:

- local metadata for Gemini explicit caching

Fields:

- `id` uuid primary key
- `conversation_id` uuid null references conversations(id)
- `path_id` uuid null references paths(id)
- `cache_key` text not null unique
- `cache_scope` text not null
- `model_name` text not null
- `gemini_cached_content_name` text not null
- `content_hash` text not null
- `token_estimate` integer null
- `ttl_seconds` integer not null
- `status` text not null default 'active'
- `last_used_at` timestamptz null
- `expires_at` timestamptz not null
- `created_at` timestamptz not null default now()

Allowed `cache_scope` values:

- `system_prefix`
- `split_snapshot`
- `docs_bundle`
- `merge_context`

Indexes:

- `(path_id, status, expires_at)`
- `(conversation_id, status, expires_at)`

## Database Rules

### Main Path Invariant

- every conversation must have exactly one main path
- `conversations.main_path_id` must point to the row where `paths.is_main = true`

### Message Sequence Rule

- `sequence_no` is contiguous inside one path
- new messages on one path never change sequence numbers on another path

### Branch Inheritance Rule

- branch creation always records the exact split point
- parent updates after the split do not mutate the branch snapshot

### Merge Rule

- a merge into main writes both:
  - a `memory_artifacts` row
  - a synthetic `messages` row on main

This keeps main memory visible in history while still preserving lineage.

## Backend Services

### conversation-service

Responsibilities:

- create conversations
- fetch conversation overview
- update titles
- resolve main path

### path-service

Responsibilities:

- create branches
- fetch lineage tree
- list paths in a conversation
- validate parent-child path relationships

Methods:

- `createMainPath(conversationId)`
- `createBranch({ conversationId, parentPathId, splitFromMessageId, title, pathType })`
- `getLineage(conversationId)`
- `getPathById(pathId)`

### message-service

Responsibilities:

- append user and assistant messages
- maintain `sequence_no`
- list messages for one path

Methods:

- `createUserMessage(pathId, content)`
- `createAssistantMessage(pathId, content, metadata)`
- `listPathMessages(pathId, limit, cursor)`

### context-assembler

Responsibilities:

- build request-ready Gemini context from path data
- separate stable prefix from volatile turn content

Outputs:

- `systemInstruction`
- `stablePrefixBlocks`
- `semiStableBlocks`
- `liveTurnMessages`
- `tokenEstimate`

Methods:

- `buildPathContext(pathId, latestUserMessageId)`
- `buildMergeContext(sourcePathId, mergeMode)`

### gemini-adapter

Responsibilities:

- map internal context format to Gemini API calls
- support normal generation and streaming
- extract usage metadata

Methods:

- `streamChat(input)`
- `generateMergeArtifact(input)`
- `countTokens(input)` if available or emulate

### cache-service

Responsibilities:

- decide when explicit caching is worth creating
- create and reuse Gemini caches
- record cache hit metadata
- expire stale cache records

Methods:

- `getReusableCache(cacheKey, contentHash, modelName)`
- `createExplicitCache(input)`
- `markCacheUsed(cacheRecordId)`
- `expireStaleCaches()`
- `selectCachePlan(context)`

### merge-service

Responsibilities:

- validate merge eligibility
- create merge jobs
- store merge artifacts
- attach merged result to main

Methods:

- `requestMerge({ sourcePathId, targetPathId, mergeMode, userId })`
- `processMerge(mergeId)`
- `attachMergeArtifactToMain(mergeId, artifactId)`

### usage-service

Responsibilities:

- estimate costs
- persist run telemetry
- report cache and token metrics

## Context Assembly Design

This is the most important backend logic in the MVP.

### Chat Context Layout

For one active path, build context in this order:

1. global system instruction
2. stable path instruction block
3. inherited split snapshot
4. active memory artifacts attached to the path
5. recent path-local messages
6. latest user message

Why this order:

- stable shared content should come first for cache reuse
- the latest user turn should remain at the end for model clarity

### Main Path Context

Use:

- system instruction
- active main memory artifacts
- recent main messages
- latest user turn

### Branch Path Context

Use:

- system instruction
- split snapshot from parent
- active branch-specific artifacts
- recent branch-local messages
- latest user turn

Do not include future parent-path messages by default.

### Merge Context

Use:

- system instruction for merge behavior
- source branch split snapshot
- recent branch-local messages or final branch slice
- optional target-path summary if needed
- explicit merge mode instruction

## Prompt Templates

Store prompts as versioned template files in `src/lib/prompts`.

### 1. chat-system.md

Purpose:

- standard chat behavior for main and branch responses

Key instructions:

- preserve path-local continuity
- use inherited memory but do not invent parent updates
- answer clearly and directly

### 2. merge-light.md

Purpose:

- produce a compact memory artifact for main

Output:

- 1 short memory block
- no transcript copying

### 3. merge-full.md

Purpose:

- produce a richer structured artifact

Output shape:

- summary
- conclusions
- decisions
- open questions

### 4. branch-title.md

Purpose:

- generate concise branch titles when user does not supply one

## API Routes

All examples are MVP-oriented and can be prefixed with `/api`.

### Conversations

`POST /conversations`

- create conversation
- create main path

Request:

```json
{
  "title": "Untitled conversation"
}
```

Response:

```json
{
  "conversationId": "uuid",
  "mainPathId": "uuid"
}
```

`GET /conversations/:conversationId`

- return conversation summary, main path, branch tree

### Paths

`POST /paths/:pathId/branch`

- create a branch from a message on that path

Request:

```json
{
  "splitFromMessageId": "uuid",
  "title": "Compare strategy B",
  "pathType": "research"
}
```

Response:

```json
{
  "pathId": "uuid",
  "parentPathId": "uuid",
  "snapshotId": "uuid"
}
```

`GET /conversations/:conversationId/paths`

- list paths and lineage metadata

`GET /paths/:pathId/messages`

- list messages for one path

### Messages

`POST /paths/:pathId/messages`

- create a user message and start streaming assistant response

Request:

```json
{
  "content": "Let's compare options here."
}
```

Response:

- SSE stream or stream session token

### Merges

`POST /merges`

- request merge from source branch into target path

Request:

```json
{
  "sourcePathId": "uuid",
  "targetPathId": "uuid",
  "mergeMode": "light"
}
```

Response:

```json
{
  "mergeId": "uuid",
  "status": "pending"
}
```

`GET /merges/:mergeId`

- get merge status and result

### Telemetry

`GET /paths/:pathId/runs`

- debug view for model runs, cache usage, and failures

## Streaming Design

For the MVP, use SSE because it is simpler than WebSockets.

### Server Events

- `run.started`
- `message.delta`
- `message.completed`
- `run.completed`
- `run.error`

### Server Flow

1. client opens SSE connection
2. backend starts Gemini stream
3. backend forwards partial deltas
4. backend persists final assistant message
5. backend emits completion event

### Failure Behavior

If stream fails:

- mark `model_runs.status = failed`
- preserve user message
- do not create assistant message unless completion is valid
- return retry action in UI

## Prompt Caching Design

### When To Use Implicit Caching

Default for:

- regular follow-ups on same path
- repeated branch runs with mostly similar prefix

Implementation rule:

- keep system instructions and split snapshot before recent messages

### When To Use Explicit Caching

Use explicit caching only if both are true:

- stable prefix is large enough to justify it
- the prefix is likely to be reused multiple times soon

Initial candidates:

- long split snapshots
- large document bundles
- merge contexts reused across review or compare actions

### Cache Planning Algorithm

Pseudo-logic:

```ts
if (context.stablePrefixTokens < MIN_EXPLICIT_CACHE_TOKENS) {
  return { mode: "implicit" };
}

if (!context.isLikelyReusable) {
  return { mode: "implicit" };
}

const existing = findActiveCacheByHash(context.hash, context.modelName);
if (existing && existing.expiresAt > now()) {
  return { mode: "explicit", cacheRecordId: existing.id };
}

return { mode: "create-explicit" };
```

### Initial Threshold Strategy

Use configuration values:

- `MIN_EXPLICIT_CACHE_TOKENS`
- `DEFAULT_SPLIT_SNAPSHOT_TTL_SECONDS`
- `DEFAULT_DOC_CACHE_TTL_SECONDS`
- `MAX_RECENT_MESSAGES_PER_PATH`

These should be environment variables, not hardcoded.

### Cache Cleanup

Background worker should:

- mark expired cache records inactive
- optionally call Gemini delete for explicit caches when appropriate
- prune orphaned records

## Frontend Implementation Plan

The MVP frontend should optimize for clarity, not maximum graph freedom.

### Main Screens

#### 1. Conversation Workspace

Contains:

- main path column
- optional side branch panels
- lineage strip or mini tree
- merge actions

#### 2. Conversation List

Contains:

- recent conversations
- title
- updated time

### Core Components

- `ConversationWorkspace`
- `PathColumn`
- `MessageList`
- `MessageComposer`
- `BranchButton`
- `BranchPanel`
- `LineageTree`
- `MergeDialog`
- `StreamStatusBadge`

### Frontend State Model

Keep a small client state shape:

```ts
type WorkspaceState = {
  activeConversationId: string | null;
  activeMainPathId: string | null;
  openBranchPathIds: string[];
  selectedMergeSourcePathId: string | null;
  streamingRunByPathId: Record<string, string | null>;
};
```

### Frontend UX Rules

- main path is always visible
- branches open in side panels, not fullscreen by default
- merge action is visible only on non-main paths
- branch provenance should be visible near the branch title
- if a merge is completed, show a linked marker in both source branch and main path

## Background Jobs

Worker queue should initially support:

- `process-merge`
- `generate-branch-title`
- `cleanup-expired-caches`
- optional `refresh-path-summary`

## Configuration

Store these in environment variables:

- `DATABASE_URL`
- `GEMINI_API_KEY`
- `GEMINI_DEFAULT_MODEL`
- `GEMINI_MERGE_MODEL`
- `MIN_EXPLICIT_CACHE_TOKENS`
- `DEFAULT_SPLIT_SNAPSHOT_TTL_SECONDS`
- `DEFAULT_DOC_CACHE_TTL_SECONDS`
- `MAX_RECENT_MESSAGES_PER_PATH`
- `ENABLE_EXPLICIT_CACHE`

## Security And Validation

### Backend Validation

- validate path ownership through conversation ownership
- validate split message belongs to the source path
- validate merge source and target belong to the same conversation
- reject merge into non-main path in MVP if product rules require main-only merge first

### Prompt Safety

- sanitize system-generated metadata before including it in prompts
- keep internal IDs out of model-facing text unless needed
- separate operator instructions from user content

## Observability

At minimum, log:

- conversation id
- path id
- run id
- model name
- latency
- input tokens
- output tokens
- cached tokens
- cache mode
- error type

Build one internal admin/debug view for:

- failed runs
- merge failures
- cache hit ratio
- token cost by path

## Implementation Sequence

### Milestone 1: Project Scaffold

- initialize frontend and backend app
- connect PostgreSQL
- add ORM and migrations
- set up env config

### Milestone 2: Core Data Model

- implement users, conversations, paths, messages tables
- implement path creation and message append logic
- enforce main-path invariant

### Milestone 3: Main Chat

- create conversation endpoint
- main path message endpoint
- Gemini streaming adapter
- SSE client rendering

### Milestone 4: Branching

- branch creation endpoint
- split snapshot creation
- branch message endpoint
- lineage tree response

### Milestone 5: Merge

- merges table and worker
- merge prompt templates
- memory artifact creation
- synthetic merged message on main

### Milestone 6: Caching

- cache_records table
- implicit-first prompt ordering
- explicit cache creation and reuse for large stable prefixes
- cache telemetry

### Milestone 7: Polish

- branch titles
- merge markers in UI
- basic cost dashboard
- retry behavior and failure UI

## Testing Plan

### Unit Tests

- path sequence assignment
- branch snapshot creation
- merge attachment logic
- cache planning decisions
- context assembly order

### Integration Tests

- create conversation and send main message
- branch from message and continue independently
- merge branch into main and verify synthetic main message
- repeated branch calls reuse explicit cache when eligible

### Manual QA Scenarios

- continue main without merging from branch
- create multiple branches from same split point
- merge one branch while leaving another untouched
- verify branch does not see future main messages unless explicitly supported later

## Open MVP Decisions

These are still implementation choices, not blockers.

- whether to allow merge into non-main paths after MVP
- whether branch-local summaries are generated eagerly or lazily

## Recommended Immediate Build Order

If we start coding right away, the most efficient order is:

1. schema and migrations
2. create conversation and main chat
3. Gemini streaming adapter
4. branch creation and branch chat
5. merge worker and merge artifacts
6. caching layer
7. lineage and polish

## One-line Technical Summary

Implement the MVP as a Gemini-first, PostgreSQL-backed branching chat system where each path has scoped memory, branches inherit a frozen split snapshot, and merges create memory artifacts that are written back into the main path as usable future memory.
