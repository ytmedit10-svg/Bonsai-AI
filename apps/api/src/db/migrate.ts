import path from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { db, pool } from "./client.js";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../../..");
const migrationsFolder = path.join(workspaceRoot, "apps/api/drizzle");

try {
  await migrate(db, {
    migrationsFolder
  });
  console.log("Database migrations applied.");
} finally {
  await pool.end();
}
