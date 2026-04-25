# Node-based Chat

Gemini-first branching chat workspace scaffold.

## Workspace Layout

- `apps/web`: React + Vite frontend
- `apps/api`: Fastify backend
- `packages/shared`: shared constants and types

## Getting Started

1. Copy `.env.example` to `.env`.
2. Start PostgreSQL with `docker compose up -d postgres`.
3. Install dependencies with `npm install`.
4. Run both apps with `npm run dev`.

## Scripts

- `npm run dev`
- `npm run dev:web`
- `npm run dev:api`
- `npm run db:generate`
- `npm run db:migrate`
- `npm run build`
- `npm run typecheck`

## Database Foundation

The API app uses Drizzle ORM with PostgreSQL.

- schema: `apps/api/src/db/schema.ts`
- client: `apps/api/src/db/client.ts`
- config: `drizzle.config.ts`
- generated migrations: `apps/api/drizzle`
