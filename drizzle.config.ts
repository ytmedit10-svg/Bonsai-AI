import "dotenv/config";

import { defineConfig } from "drizzle-kit";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://postgres@localhost:5432/node_based_chat";

export default defineConfig({
  out: "./apps/api/drizzle",
  schema: "./apps/api/src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl
  },
  strict: true,
  verbose: true
});
