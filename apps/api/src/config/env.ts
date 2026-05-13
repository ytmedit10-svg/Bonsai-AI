import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";
import { z } from "zod";

import { APP_NAME, DEFAULT_API_HOST, DEFAULT_API_PORT } from "@node-based-chat/shared";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const workspaceRoot = path.resolve(currentDir, "../../../..");

config({
  path: path.join(workspaceRoot, ".env")
});

const truthyValues = new Set(["1", "true", "yes", "on"]);
const falseyValues = new Set(["0", "false", "no", "off"]);

const parseBooleanFlag = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (truthyValues.has(normalized)) {
    return true;
  }

  if (falseyValues.has(normalized)) {
    return false;
  }

  return fallback;
};

const parseCommaSeparatedList = (value: string | undefined, fallback: string[]) => {
  if (value === undefined) {
    return fallback;
  }

  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length > 0 ? Array.from(new Set(items)) : fallback;
};

const envSchema = z.object({
  API_HOST: z.string().default(DEFAULT_API_HOST),
  API_PORT: z.coerce.number().int().positive().default(DEFAULT_API_PORT),
  API_ADMIN_KEY: z.string().optional(),
  DATABASE_URL: z.string().default(
    "postgres://postgres@localhost:5432/node_based_chat"
  ),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ENDPOINT: z.string().url().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  ATTACHMENT_STORAGE_PROVIDER: z.enum(["auto", "local", "r2"]).default("auto"),
  LOCAL_UPLOAD_DIR: z.string().default(".runtime/uploads"),
  AI_PROVIDER: z.enum(["auto", "gemini", "ollama", "mock"]).default("gemini"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_DEFAULT_MODEL: z.string().default("gemma-4-31b-it"),
  GEMINI_MERGE_MODEL: z.string().default("gemma-4-31b-it"),
  GEMINI_AVAILABLE_MODELS: z
    .string()
    .optional()
    .transform((value) =>
      parseCommaSeparatedList(value, ["gemma-4-31b-it"])
    ),
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().default("gemma4:e4b"),
  OLLAMA_MERGE_MODEL: z.string().default("gemma4:e4b"),
  OLLAMA_NUM_CTX: z.coerce.number().int().positive().default(2048),
  MIN_EXPLICIT_CACHE_TOKENS: z.coerce.number().int().positive().default(2048),
  DEFAULT_SPLIT_SNAPSHOT_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  DEFAULT_DOC_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(21600),
  COMPACTION_TRIGGER_MESSAGES: z.coerce.number().int().positive().default(32),
  COMPACTION_KEEP_RECENT_MESSAGES: z.coerce.number().int().positive().default(12),
  COMPACTION_MAX_SOURCE_MESSAGES: z.coerce.number().int().positive().default(80),
  CONTEXT_MAX_ESTIMATED_TOKENS: z.coerce.number().int().positive().default(100000),
  CONTEXT_MAX_MERGE_MEMORIES: z.coerce.number().int().positive().default(3),
  CONTEXT_MAX_RETRIEVAL_CANDIDATES: z.coerce.number().int().positive().default(4),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().max(512).default(64),
  EMBEDDING_MODEL: z.string().default("local-hash-embedding-v1"),
  JOB_LOCK_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
  JOB_MAINTENANCE_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
  JOB_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  COST_INPUT_USD_PER_MTOKENS: z.coerce.number().nonnegative().default(0),
  COST_OUTPUT_USD_PER_MTOKENS: z.coerce.number().nonnegative().default(0),
  ENABLE_EXPLICIT_CACHE: z
    .string()
    .optional()
    .transform((value) => parseBooleanFlag(value, true)),
  DEV_BOOTSTRAP_USER_EMAIL: z
    .string()
    .email()
    .default("demo@nodebasedchat.local"),
  DEV_BOOTSTRAP_USER_NAME: z.string().default("Demo User"),
  MAX_RECENT_MESSAGES_PER_PATH: z.coerce.number().int().positive().default(24)
});

export type Env = z.infer<typeof envSchema> & {
  APP_NAME: string;
};

export const loadEnv = (): Env => {
  const env = envSchema.parse(process.env);
  const geminiAvailableModels = Array.from(
    new Set([
      ...env.GEMINI_AVAILABLE_MODELS,
      env.GEMINI_DEFAULT_MODEL,
      env.GEMINI_MERGE_MODEL
    ])
  );

  return {
    ...env,
    GEMINI_AVAILABLE_MODELS: geminiAvailableModels,
    APP_NAME
  };
};
