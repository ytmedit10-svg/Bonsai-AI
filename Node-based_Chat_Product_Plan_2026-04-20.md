# Node-based Chat Product Plan

Date: 2026-04-20
Workspace: D:\Node-based chat

## Working Title

Node-based Chat

## Model Provider Decision

The initial product version will use the Gemini API as the first and only model provider.

This means:

- the MVP will be designed around Gemini-first capabilities and limits
- the product should still keep an internal abstraction layer so other providers can be added later if needed
- provider expansion is a later phase, not an MVP requirement

### Gemini-first Recommendation

For the MVP, a practical starting point is:

- Gemini 2.5 Flash for most main-path and branch chat runs
- optional later use of Gemini 2.5 Pro for heavier merge, planning, or coding tasks if quality demands it

This keeps the early product faster and cheaper while leaving room for higher-quality specialized runs later.

## Core Product Definition

This product is not just a visual node canvas for AI chat.

It is a conversation system with:

- one canonical main memory path
- branch memory paths that can be created from any point in the main path or from another branch
- independent continuation of each path after the split
- optional merge of branch outcomes back into the main path
- merged results becoming part of the main path's usable memory

The main idea is:

Users should be able to explore multiple directions without corrupting the main conversation, and later bring only the useful results back into the main memory.

## Product Vision

Build an AI workspace where thinking does not have to stay linear.

The user keeps one primary conversation line for continuity, while side branches act as safe exploration zones for alternatives, research, critique, planning, or drafting. When a branch produces something valuable, the system can merge that value back into the main path so the main conversation truly learns from it.

## Core Principles

- Main path is the canonical memory line.
- Branching should never block the main flow.
- A branch inherits memory from the exact split point, not from future parent updates by default.
- Main and branch continue independently after the split.
- Merge is optional, not required.
- A merge should update main's future usable memory.
- Merge behavior can adapt based on context budget, token cost, and user intent.
- Lineage should remain understandable even when memory is compressed.

## Mental Model

The easiest way to explain the system is:

- main path = canonical working memory
- branch = memory fork created from a chosen point
- sub-branch = fork created from inside another branch
- merge = convert branch output into memory that main can carry forward

This is closer to conversation version control than normal chat.

## Memory Model

### 1. Main Path Memory

The main path contains:

- the original conversation history on main
- all user and assistant messages created directly on main
- all accepted merge results written into main
- any system-generated memory artifacts that are explicitly attached to main

The main path is the source of continuity for the conversation.

### 2. Branch Memory

When a user creates a branch from a specific message or point in a path:

- the branch inherits the parent memory state up to that exact split point
- the branch does not automatically inherit future parent messages
- the branch then accumulates its own local history and memory
- sub-branches can be created from that branch using the same rule

Default rule:

Branch memory = parent snapshot at split time + branch-local continuation

Not:

Branch memory = permanently live-synced parent memory

This keeps the system predictable.

### 3. Optional Memory Refresh

In a later version, the system may allow manual import of newer parent memory into a branch.

This should be:

- explicit
- user-triggered
- visible in lineage

It should not happen silently by default.

## Merge Model

Merge is the product's most important mechanic.

Merging should not usually mean copying an entire branch transcript into main. Instead, merging should create a memory artifact that main can use naturally in future conversation.

### Merge Goal

After a merge, the main path should behave as if it has learned the useful result of the branch.

### Merge Output

A merge can produce one of the following:

- a distilled conclusion
- a final answer
- a structured decision
- extracted assumptions and findings
- a compressed memory block designed for future continuation
- selected messages chosen by the user

### Merge Modes

The system can support multiple merge modes.

#### 1. Light Merge

Main receives only the key conclusion or outcome from the branch.

Best for:

- small context windows
- quick reintegration
- low-cost operation

#### 2. Full Merge

Main receives a richer structured memory artifact with more detail.

Best for:

- important branch outcomes
- complex planning
- coding, research, or strategy branches

#### 3. Reference Merge

Main receives the merge result, while the original branch remains visible and linked for provenance.

Best for:

- traceability
- review workflows
- research or decision history

#### 4. Collapse Merge

The branch is compressed behind the scenes into main's memory artifact when full lineage visibility is not necessary or the context budget is tight.

Best for:

- smaller models
- context-limited sessions
- keeping the interface lighter

### Merge Strategy Rule

The system can choose between preserving lineage and collapsing memory based on:

- available context window
- token cost
- model capability
- branch importance
- likelihood of future review
- user-selected intent

## Required Product Behaviors

The product must support all three of these user behaviors:

- continue only on the main path
- explore only in branches without merging
- explore in branches and later merge selected outcomes into main

This is critical because the product should feel flexible, not procedural.

## UX Model

The first version should not start as a fully freeform canvas.

The better first product shape is:

- a central main conversation
- visible branch points on messages
- the ability to open one or more branches side by side
- a clear action to merge branch results into main
- a visible lineage view so users can understand what came from where

This creates a structured branching interface instead of immediate graph chaos.

## MVP Scope

The MVP should prove the memory model, not the whole vision at once.

### MVP Features

- Create a root main conversation
- Branch from any message in the main path
- Continue main after branching without any required merge
- Continue each branch independently
- Create sub-branches from branches
- View branch lineage
- Compare branch outputs
- Merge a branch result back into main
- Make merged output part of main's usable memory
- Keep branch history preserved at least in the initial version

### What the MVP Should Not Try to Solve Yet

- full freeform infinite canvas behavior
- automatic live-sync memory between parent and branch
- complex multi-branch auto-merging
- advanced autonomous agents
- too many model providers at once
- heavy vector-memory systems on day one

## Recommended V1 Product Rules

### Branch Creation

- User chooses a message or point in a path.
- System creates a new branch from that point.
- Branch receives a snapshot of memory available at that point.
- Branch gets its own identity, title, and status.

### Main Continuation

- Main remains active after any branch is created.
- User can keep chatting on main immediately.
- Main does not wait for branch completion.

### Branch Continuation

- Each branch keeps its own message history.
- Branch responses use branch-local memory plus inherited split memory.
- Branches do not automatically update main.

### Merge Into Main

- User selects a branch and chooses merge.
- System generates a merge artifact based on mode.
- That artifact is written into main as a memory event.
- Future main responses can use that merged memory naturally.

## Suggested Initial Node Types

Even if all nodes use the same underlying model, the product can feel much stronger if branches have clear roles.

Suggested types:

- Chat
- Research
- Brainstorm
- Critique
- Planner
- Writer
- Merge

These can later map to distinct prompts, tools, or memory policies.

## Data Model Direction

PostgreSQL is a strong starting point.

The data is mostly relational with lineage and event history, so a graph database is not required for the MVP.

### Candidate Entities

- conversations
- paths
- messages
- path_snapshots
- merges
- memory_artifacts
- model_runs

### Path Fields

- id
- conversation_id
- parent_path_id
- split_from_message_id
- is_main
- title
- created_at

### Message Fields

- id
- path_id
- role
- content
- created_at
- model_provider
- model_name

### Merge Fields

- id
- source_path_id
- target_path_id
- merge_mode
- memory_artifact_id
- created_at

### Memory Artifact Fields

- id
- path_id
- type
- content
- source_merge_id
- visible_as_lineage_reference
- created_at

## Basic Architecture

The first version should use a simple service-oriented architecture instead of a complex agent framework.

### Core Layers

#### 1. Frontend

Responsibilities:

- render the main conversation path
- show branch points and branch lineage
- open branches side by side
- trigger branch creation and merges
- stream model responses

Suggested stack:

- React
- React Flow only if needed for lineage or node views
- SSE or WebSocket streaming

#### 2. API Server

Responsibilities:

- authenticate users
- manage conversations, paths, messages, and merges
- assemble scoped context for each run
- call Gemini through one internal adapter
- track token usage, latency, and cache hit data

Suggested stack:

- Node.js backend
- one internal Gemini service module

#### 3. Database

Responsibilities:

- store canonical path and branch lineage
- store messages and merge events
- store memory artifacts and path snapshots
- store run metadata and cost analytics

Suggested stack:

- PostgreSQL

#### 4. Background Jobs

Responsibilities:

- long-running merge generation
- branch summarization
- title generation
- cleanup of stale cache references

Suggested stack:

- lightweight queue worker
- Redis only if job orchestration or rate control becomes necessary

#### 5. Object and Cache Layer

Responsibilities:

- store uploaded files if the product supports file context
- store Gemini cache metadata
- track explicit cached content IDs and expiration times

Suggested stack:

- file/object storage if uploads are enabled
- database table for cache metadata

### Core Runtime Flow

For any main-path or branch response:

1. User sends a message to a path.
2. Backend loads the active path and lineage metadata.
3. Context assembler builds the prompt from:
   - path-local messages
   - inherited split snapshot
   - previously merged memory artifacts
   - optional referenced files or imported context
4. Cache planner decides:
   - reuse an existing explicit cache
   - rely on Gemini implicit caching
   - or send the request without caching
5. Gemini adapter sends the request and streams the response.
6. Backend stores the assistant message, run metadata, token usage, and cache stats.

For a merge:

1. User selects a branch and merge mode.
2. Backend gathers branch-local output plus required lineage context.
3. Merge generator creates a memory artifact for main.
4. Backend writes that artifact into main as a merge-linked memory event.
5. Future main-path runs include that memory artifact in context assembly.

## Prompt Caching Strategy

Prompt caching should be treated as a first-class architecture feature because this product naturally reuses large shared prefixes across branches.

### Why It Matters For This Product

Many branches share the same inherited memory prefix from the split point.

That makes this product especially well suited to Gemini context caching, because repeated parent context, branch snapshots, system instructions, and attached files can be reused across multiple calls instead of being fully resent each time.

### Gemini Caching Rules To Design Around

Based on the current Gemini docs:

- Gemini 2.5 and newer models have implicit caching enabled automatically
- explicit caching is available when we want guaranteed savings
- explicit caches have a TTL and default to 1 hour if not set
- cache hits can be observed through usage metadata

### What To Cache

The system should prefer caching stable prefixes, not volatile turn-by-turn content.

Good candidates:

- long system instructions
- inherited parent snapshot at branch creation
- large uploaded files or document bundles
- stable branch memory summaries
- reusable merge context blocks

Bad candidates:

- the newest user message
- rapidly changing short prompts
- tiny contexts that do not justify cache overhead

### Two-level Caching Approach

#### 1. Implicit Caching By Default

For Gemini 2.5 models, we should structure prompts so shared content is placed first whenever possible.

That increases the chance of implicit cache hits across:

- repeated branch runs
- merge generation
- follow-up questions on the same path

#### 2. Explicit Caching For Large Stable Context

We should create explicit Gemini caches for heavyweight reusable context such as:

- a branch split snapshot with long inherited memory
- a document pack attached to a path
- large merge/reference context reused across multiple prompts

This gives more predictable savings than relying only on implicit caching.

### Cache Key Strategy

We should create cache records around stable logical units, not around every request.

Examples:

- `conversation:{id}:main_snapshot:{version}`
- `path:{id}:split_snapshot:{version}`
- `path:{id}:docs_bundle:{version}`
- `merge:{id}:context:{version}`

Each cache record should store:

- local cache key
- Gemini cached content ID
- model name
- token estimate
- creation time
- expiration time
- status

### TTL Strategy

Suggested MVP rule:

- short TTL for active chat context
- longer TTL for uploaded documents and stable reference packs
- refresh cache only when the underlying snapshot or document bundle changes

This avoids paying repeatedly for content that many requests reuse.

### Context Assembly Rule For Caching

The context builder should separate every request into:

- stable prefix
- semi-stable memory artifacts
- volatile user turn

Only the stable prefix should be strongly considered for explicit caching.

This is important because caching works best when the repeated content stays identical.

### Analytics We Should Store

For each Gemini run, store:

- input token count
- output token count
- cached token count if returned
- model name
- latency
- estimated cost
- cache mode used: none, implicit, explicit

This will tell us whether the branching model is financially working.

## System Logic Direction

The backend should think in terms of scoped conversation contexts instead of one giant transcript.

At runtime, a path response should be built from:

- local messages in the active path
- inherited memory from the split point
- previously merged memory artifacts attached to that path
- optional selected references if the user explicitly imports them

This prevents the system from sending the entire graph on every call.

### Internal Service Modules

A clean backend split for the MVP would be:

- `conversation-service`
- `path-service`
- `message-service`
- `context-assembler`
- `gemini-adapter`
- `cache-service`
- `merge-service`
- `usage-service`

This is enough structure to keep the codebase clean without overengineering the first version.

## Success Criteria For The MVP

The MVP is successful if users feel these things:

- "I can explore without losing the main thread."
- "I do not have to choose between one chat and starting over."
- "When I merge something back, the main conversation actually remembers it."
- "The branch structure makes sense without becoming messy."

## Biggest Risks

### 1. Graph Chaos

If branching becomes too visual too early, the product will feel complicated.

### 2. Weak Merge Quality

If merge results are vague, bloated, or unreliable, the whole system loses value.

### 3. Cost Explosion

Multiple active branches can multiply inference costs quickly if context is not tightly scoped.

### 4. Confusing Memory Rules

If users cannot tell what a branch knows and what main knows, trust will drop fast.

## Product Differentiation

The differentiator is not "chat on a node graph."

The differentiator is:

- one canonical main memory line
- independent branch memory lineages
- optional merge back into canonical memory
- adaptive preservation or compression of branch lineage based on context

This makes the product a memory orchestration system, not just a chat UI variation.

## Recommended Build Order

### Phase 1

- main path chat
- branch from message
- independent branch memory
- compare branches
- manual merge into main
- Gemini-only provider integration

### Phase 2

- sub-branches
- merge modes
- lineage view improvements
- branch titles and categories
- better context compression

### Phase 3

- manual import of newer parent memory into branch
- smarter merge recommendations
- multi-model routing if Gemini-first validation succeeds
- advanced research and planning branch types

## One-line Product Summary

A chat system with one canonical main memory path, where users can create independent branch memory paths from any point, continue main and branches separately, and optionally merge branch outcomes back into main so the main path truly learns from them.

## Immediate Next Steps

- Turn this plan into a product spec with user flows
- Define exact merge modes and UI actions
- Design the path, message, and merge database schema
- Choose the first frontend shape: structured branch UI versus full node view
- Define a Gemini adapter interface for chat, streaming, and merge generation
- Design the cache-service for implicit and explicit Gemini prompt caching
- Build a tiny prototype that proves split, independent memory, and merge-to-main behavior
