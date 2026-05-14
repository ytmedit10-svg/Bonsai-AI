# Bonsai AI

Bonsai AI is a branching chat workspace for exploring one conversation as a
tree of paths. It supports Gemma 4 through local Ollama for private local
development, hosted Gemini for API-backed inference, and PostgreSQL persistence
through Drizzle.

## What This App Does

Most chat apps treat a conversation like a single straight line. Bonsai AI keeps
the main conversation intact while letting you fork specific ideas into separate
branches.

The basic workflow is:

1. Start a main chat.
2. Branch from a message or a selected section of an assistant response.
3. Continue that branch independently without overwriting the main path.
4. Inspect the conversation structure as a desktop graph or mobile thread tree.
5. Merge useful branch outcomes back into main memory when they should influence
   the primary conversation.

This makes it easier to explore alternatives, compare directions, and preserve
the reasoning trail behind a decision.

```mermaid
flowchart LR
  main["Main chat path"]
  answer["Assistant answer"]
  branchA["Branch: practical follow-up"]
  branchB["Branch: creative angle"]
  branchC["Branch: critical review"]
  merge["Merge useful result into main memory"]

  main --> answer
  answer --> branchA
  answer --> branchB
  answer --> branchC
  branchA --> merge
  branchB --> merge
  branchC --> merge
  merge --> main
```

## Core Features

- Branching conversation paths: every branch is a real path with its own
  message history, parent, split point, and title.
- Branch creation from selected content: fork from a response block, heading,
  list item, or selected passage instead of copying context into a new chat.
- Desktop graph and mobile thread tree: desktop users get a horizontal graph;
  mobile users get a vertical, collapsible branch outline.
- Merge memory into main: turn useful branch work into a memory artifact that is
  attached back to the main path.
- Gemma 4 model selector: local Ollama models are detected from installed
  `gemma4:*` models, while hosted Gemini models come from
  `GEMINI_AVAILABLE_MODELS`.
- Fast and Thinking modes: choose a quick response mode or a deeper reasoning
  mode from the chat input model menu.
- Context snapshots and compaction: branches inherit a snapshot at split time,
  and older path messages can be compacted into durable path memory.
- Provenance and observability: inspect model runs, context bundles, included
  memory, retrieval candidates, token usage, and run status from the admin UI.
- Read-only sharing: generate a public shared view for a conversation and its
  branches without exposing editing controls.

## Why It Exists

Bonsai AI is for work where one answer path is not enough. It is useful for
comparing tones, plans, research directions, implementation approaches, and
tradeoffs without losing the original thread.

It is also a practical local Gemma 4 playground: run the app, API, native
Postgres, and Ollama on your own machine to test private branching workflows
with local models, or switch to hosted Gemini when you want API-backed
inference.

## Prerequisites

- Node.js 20 or newer
- npm
- PostgreSQL installed locally
- Passwordless local Postgres auth enabled, or a working `DATABASE_URL`
- Ollama, optional for local Gemma 4 inference
- Gemini API key, optional for hosted Gemini inference

Docker is not required and is not used by the local development flow.

## Quick Start

Install dependencies:

```bash
npm install
```

On Windows, prepare native Postgres once from an Administrator PowerShell:

```powershell
npm run setup:postgres:windows
```

That helper installs or finds PostgreSQL 17, adds `psql` to PATH, enables
passwordless local auth for `localhost`, restarts the Postgres service, and tests
the connection.

The default app configuration expects this connection:

```env
DATABASE_URL=postgres://postgres@localhost:5432/node_based_chat
```

Run the app:

```bash
npm run dev
```

`npm run dev` is the local-private shortcut. It is equivalent to:

```bash
npm run dev:local
```

The web app runs at `http://127.0.0.1:5173` and the API runs at
`http://127.0.0.1:4000` by default.

On startup, `npm run dev` runs a local preflight that:

- creates `.env` from `.env.example` when `.env` is missing
- checks native local Postgres using `DATABASE_URL`
- creates the local `node_based_chat` database when it is missing and the
  connection is local
- runs Drizzle migrations with `npm run db:migrate`
- checks for local Ollama Gemma 4 models when `AI_PROVIDER=ollama`
- starts the web and API dev servers

## Two App Modes

Bonsai AI uses one codebase with two environment modes.

Local/private mode:

- command: `npm run dev` or `npm run dev:local`
- env template: `.env.local.example`
- inference: local Ollama with installed `gemma4:*` models
- database: native local Postgres
- uploads: local disk under `.runtime/uploads` when R2 is not configured

Hosted/API-backed mode:

- command: `npm run dev:hosted`
- env template: `.env.hosted.example`
- inference: hosted Gemini
- database: hosted Postgres such as Neon or Supabase
- uploads: R2

Both modes use the same React app, Fastify API, Drizzle schema, graph UI,
branching workflow, merge memory, and model selector behavior. The environment
decides which model provider and asset storage backend are active.

## Native Local Postgres Setup

### Windows Helper

Run this once from an Administrator PowerShell:

```powershell
npm run setup:postgres:windows
```

If PowerShell says scripts are blocked, the npm command already uses
`-ExecutionPolicy Bypass` for this script. If the script says it is not running
as Administrator, reopen PowerShell as Administrator and run it again.

After it succeeds, run:

```powershell
npm run dev
```

### Manual Setup

The default local connection is passwordless:

```env
DATABASE_URL=postgres://postgres@localhost:5432/node_based_chat
```

That means Postgres must allow local connections for the `postgres` user without
a password. Test it with:

```bash
psql postgres://postgres@localhost:5432/postgres
```

If that command connects, `npm run dev` can create the `node_based_chat`
database if needed and then run migrations.

If your local Postgres requires a password, either enable passwordless local auth
or set `DATABASE_URL` to your real local user/password:

```env
DATABASE_URL=postgres://postgres:your-password@localhost:5432/node_based_chat
```

Run migrations manually when needed:

```bash
npm run db:migrate
```

Generate a migration after schema changes:

```bash
npm run db:generate
```

## Local Ollama Setup

The default `.env.example` is configured for local Ollama:

```env
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma4:e4b
OLLAMA_MERGE_MODEL=gemma4:e4b
OLLAMA_NUM_CTX=2048
```

Install Ollama first:

Windows:

```powershell
winget install -e --id Ollama.Ollama
```

Or download it from:

```text
https://ollama.com/download
```

After installing, open the Ollama app once. On Windows this starts the Ollama
background server. Confirm it is running:

```powershell
ollama list
```

You can also check the local API directly:

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

Install the recommended local Gemma 4 model:

```bash
ollama pull gemma4:e4b
```

If your machine can handle a larger model, you can also install:

```bash
ollama pull gemma4:31b
```

The app detects installed Ollama models whose names start with `gemma4:` and
shows them in the chat input model selector. Each detected model can be used in
`Fast` or `Thinking` mode. The selector affects real chat generation,
regeneration, merge generation, titles, and compaction work.

Test the model before using it in the app:

```powershell
ollama run gemma4:e4b "Say hello in one sentence."
```

If this fails, Bonsai AI will fail too. Close other memory-heavy apps, restart
Ollama, or use the smallest installed Gemma 4 model.

`npm run dev` warns when Ollama or a Gemma 4 model is missing, but it does not
download models automatically.

## Attachment Storage

Attachment storage is selected by `ATTACHMENT_STORAGE_PROVIDER`:

```env
ATTACHMENT_STORAGE_PROVIDER=auto
LOCAL_UPLOAD_DIR=.runtime/uploads
```

Supported values:

| Value | Behavior |
| --- | --- |
| `auto` | Use R2 when all R2 env vars are real values; otherwise use local disk |
| `local` | Always store uploads on local disk |
| `r2` | Require R2 env vars and fail uploads if they are missing |

Local uploads are stored under `.runtime/uploads` by default and are served
through the same `/attachments/:id/content` API route as R2-backed uploads.
Metadata still lives in Postgres either way.

## Hosted Gemini Setup

To use hosted Gemini instead of local Ollama, update `.env`:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your-gemini-api-key
GEMINI_AVAILABLE_MODELS=gemma-4-26b-a4b-it,gemma-4-31b-it
GEMINI_DEFAULT_MODEL=gemma-4-26b-a4b-it
GEMINI_MERGE_MODEL=gemma-4-26b-a4b-it
ATTACHMENT_STORAGE_PROVIDER=r2
R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
R2_BUCKET=your-r2-bucket
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
```

Hosted model options in the UI come from `GEMINI_AVAILABLE_MODELS`.
`GEMINI_DEFAULT_MODEL` is the fallback selection. `GEMINI_MERGE_MODEL` is used
as the default for merge and compaction work, and is also allowed as a selectable
hosted model.

Keep hosted model names limited to valid Gemma 4 Gemini API model IDs. The
frontend does not hardcode hosted model choices; it renders the list returned by
the API. Thinking variants are shown only for models that the API marks as
thinking-capable.

## Environment Reference

`.env.example` is the source of truth for local configuration. The first
`npm run dev` copies `.env.local.example` to `.env` if needed. `npm run
dev:hosted` copies `.env.hosted.example` when `.env` is missing. Existing `.env`
files are preserved.

Core settings:

| Variable | Purpose |
| --- | --- |
| `AI_PROVIDER` | `ollama`, `gemini`, `mock`, or `auto` |
| `DATABASE_URL` | PostgreSQL connection string |
| `API_HOST` | API bind host; defaults to `127.0.0.1`, or `0.0.0.0` when hosted `PORT` is present |
| `API_PORT` | API port, default `4000`; hosted platforms can omit this and provide `PORT` |
| `VITE_API_BASE_URL` | Frontend API URL |
| `ATTACHMENT_STORAGE_PROVIDER` | `auto`, `local`, or `r2` |
| `LOCAL_UPLOAD_DIR` | Local upload directory for local attachment storage |

Ollama settings:

| Variable | Purpose |
| --- | --- |
| `OLLAMA_BASE_URL` | Local Ollama server URL |
| `OLLAMA_MODEL` | Default local chat model |
| `OLLAMA_MERGE_MODEL` | Default local merge/compaction model |
| `OLLAMA_NUM_CTX` | Ollama context window setting |

Gemini settings:

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Hosted Gemini API key |
| `GEMINI_AVAILABLE_MODELS` | Comma-separated hosted Gemma 4 Gemini API model IDs shown in the UI |
| `GEMINI_DEFAULT_MODEL` | Hosted fallback chat model |
| `GEMINI_MERGE_MODEL` | Hosted fallback merge/compaction model |

Optional settings:

| Variable | Purpose |
| --- | --- |
| `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Optional object storage for uploaded assets |
| `API_ADMIN_KEY` | Optional admin UI/API key |
| `VITE_ENABLE_ADMIN_UI` | Enables the admin/observability UI when set to `true` |
| `COST_INPUT_USD_PER_MTOKENS`, `COST_OUTPUT_USD_PER_MTOKENS` | Optional model cost estimates |

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run local preflight, then start web and API dev servers |
| `npm run dev:local` | Run local Ollama/native Postgres/local upload mode |
| `npm run dev:hosted` | Run hosted Gemini/hosted Postgres/R2 mode |
| `npm run dev:app` | Start web and API dev servers without preflight |
| `npm run dev:web` | Start only the Vite frontend |
| `npm run dev:api` | Start only the Fastify API |
| `npm run dev:worker` | Start the background worker in watch mode |
| `npm run worker` | Start the background worker |
| `npm run setup:postgres:windows` | Install/find native Postgres on Windows and enable passwordless local auth |
| `npm run db:generate` | Generate Drizzle migrations |
| `npm run db:migrate` | Apply Drizzle migrations |
| `npm run typecheck` | Run TypeScript checks across workspaces |
| `npm run build` | Build all workspaces |
| `npm run test` | Run available workspace tests |

## Troubleshooting

Postgres is not reachable:

On Windows, run this from Administrator PowerShell:

```powershell
npm run setup:postgres:windows
```

Then test:

```bash
psql postgres://postgres@localhost:5432/postgres
```

If this fails, start PostgreSQL and confirm your local auth settings.

Postgres asks for a password:

- Either enable passwordless local auth for local development.
- Or set `DATABASE_URL` with your local password.

Example password-based fallback:

```env
DATABASE_URL=postgres://postgres:your-password@localhost:5432/node_based_chat
```

Database migrations fail:

```bash
npm run db:migrate
```

Read the migration error, fix the database connection or schema issue, then
rerun `npm run dev`.

Ollama is missing or has no Gemma 4 model:

Install Ollama:

```powershell
winget install -e --id Ollama.Ollama
```

Open the Ollama app once, then install the recommended model:

```bash
ollama pull gemma4:e4b
```

Test it:

```powershell
ollama run gemma4:e4b "hello"
```

Then rerun `npm run dev`.

Gemini key is missing:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your-gemini-api-key
```

Restart the API after changing `.env`.

Ports are already in use:

- API default: `4000`
- Web default: `5173`
- Postgres default: `5432`

Change `API_PORT`, `VITE_API_BASE_URL`, or your local Postgres port if your
machine already uses those ports.

Model selector is not showing models:

- Local Ollama mode: confirm `AI_PROVIDER=ollama`, Ollama is running, and
  `ollama list` includes `gemma4:*` models.
- Hosted Gemini mode: confirm `AI_PROVIDER=gemini` and
  `GEMINI_AVAILABLE_MODELS` contains comma-separated hosted Gemma 4 IDs such as
  `gemma-4-26b-a4b-it` and `gemma-4-31b-it`.

## Privacy Modes

Local privacy mode requires all of these to run on your machine:

- web app
- API server
- native PostgreSQL
- Ollama with a local Gemma 4 model

If you use hosted Gemini, inference requests leave the machine. If you deploy the
API or database to hosted infrastructure, chat data is stored there according to
that environment.

## Workspace Layout

- `apps/web`: Vite + React frontend
- `apps/api`: Fastify + Drizzle backend
- `packages/shared`: shared constants and types
- `apps/api/drizzle`: generated database migrations
