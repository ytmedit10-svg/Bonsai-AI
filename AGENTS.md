# Repository Guidelines

## Project Structure & Module Organization
This repo is an npm workspace with three active packages:

- `apps/web`: Vite + React frontend (`src/App.tsx`, `src/styles.css`).
- `apps/api`: Fastify + Drizzle backend (`src/routes`, `src/services`, `src/db`, `src/config`).
- `packages/shared`: shared constants and types exported from `src/index.ts`.

Build output lives in `apps/*/dist`. Database migrations are generated into `apps/api/drizzle`. Treat both as generated artifacts; edit source files under `src/` instead.

## Build, Test, and Development Commands
- `npm run dev`: runs web and API together.
- `npm run dev:web`: starts the Vite frontend only.
- `npm run dev:api`: starts the Fastify API with `tsx watch`.
- `npm run build`: builds all workspaces that expose a build script.
- `npm run typecheck`: runs strict TypeScript checks across the workspace.
- `npm run db:generate`: creates Drizzle migration files from `apps/api/src/db/schema.ts`.
- `npm run db:migrate`: applies migrations using `drizzle.config.ts`.
- `docker compose up -d postgres`: starts the local PostgreSQL dependency.

## Coding Style & Naming Conventions
Use TypeScript with strict mode enabled. Follow the existing style: double quotes, semicolons, and concise typed helpers. Use `PascalCase` for React components, `camelCase` for variables/functions, and kebab-case filenames for API modules such as `conversation-service.ts` or `bootstrap-user-service.ts`. Keep shared types/constants in `packages/shared` instead of duplicating them between apps.

## Testing Guidelines
There is no dedicated automated test suite yet. Until one is added, every change should pass `npm run typecheck` and `npm run build`. For API changes, verify against the local Postgres instance and exercise affected routes manually. When adding tests, place them beside the feature or in a local `__tests__` folder and name them `*.test.ts` or `*.test.tsx`.

## Commit & Pull Request Guidelines
This checkout does not include Git metadata, so no local history was available to inspect. Use short imperative commit subjects, ideally scoped by area, for example: `api: add merge status endpoint` or `web: refine branch comparison panel`. PRs should include a clear summary, linked issue or task, setup or migration notes, and screenshots or API examples for UI or contract changes.

## Security & Configuration Tips
Copy `.env.example` to `.env` and keep secrets out of commits. Required local settings include `DATABASE_URL`, `GEMINI_API_KEY`, `API_PORT`, and `VITE_API_BASE_URL`. Do not hardcode credentials or edit generated SQL snapshots manually unless the migration itself is the intended change.
