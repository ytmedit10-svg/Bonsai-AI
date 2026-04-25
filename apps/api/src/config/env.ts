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

const envSchema = z.object({
  API_HOST: z.string().default(DEFAULT_API_HOST),
  API_PORT: z.coerce.number().int().positive().default(DEFAULT_API_PORT),
  API_ADMIN_KEY: z.string().optional(),
  DATABASE_URL: z.string().default(
    "postgresql://postgres:postgres@localhost:5432/node_based_chat"
  ),
  AI_PROVIDER: z.enum(["auto", "gemini", "groq"]).default("auto"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_DEFAULT_MODEL: z.string().default("gemma-4-26b-a4b-it"),
  GEMINI_MERGE_MODEL: z.string().default("gemma-4-26b-a4b-it"),
  GROQ_API_KEY: z.string().optional(),
  GROQ_DEFAULT_MODEL: z.string().default("llama-3.1-8b-instant"),
  GROQ_MERGE_MODEL: z.string().default("llama-3.1-8b-instant"),
  MIN_EXPLICIT_CACHE_TOKENS: z.coerce.number().int().positive().default(2048),
  DEFAULT_SPLIT_SNAPSHOT_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  DEFAULT_DOC_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(21600),
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

  return {
    ...env,
    APP_NAME
  };
};
