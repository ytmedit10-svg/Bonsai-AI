import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Client } = pg;

const workspaceRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const envPath = resolve(workspaceRoot, ".env");
const defaultDatabaseUrl = "postgres://postgres@localhost:5432/node_based_chat";
const cliArgs = process.argv.slice(2);

const getCliValue = (name, fallback) => {
  const prefix = `${name}=`;
  const inlineValue = cliArgs.find((arg) => arg.startsWith(prefix));

  if (inlineValue) {
    return inlineValue.slice(prefix.length);
  }

  const index = cliArgs.indexOf(name);

  if (index >= 0 && cliArgs[index + 1]) {
    return cliArgs[index + 1];
  }

  return fallback;
};

const envExampleFile = getCliValue("--env-example", ".env.example");
const envExamplePath = resolve(workspaceRoot, envExampleFile);
const skipOllamaCheck = cliArgs.includes("--skip-ollama");

const log = (message = "") => {
  console.log(`[local] ${message}`);
};

const warn = (message = "") => {
  console.warn(`[local warning] ${message}`);
};

const fail = (message) => {
  console.error(`[local error] ${message}`);
  process.exit(1);
};

const run = (command, args, options = {}) =>
  new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      shell: process.platform === "win32",
      stdio: options.silent ? "pipe" : "inherit"
    });

    let stdout = "";
    let stderr = "";

    if (options.silent) {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", (error) => {
      resolvePromise({
        code: 1,
        error,
        stderr,
        stdout
      });
    });

    child.on("close", (code) => {
      resolvePromise({
        code: code ?? 1,
        stderr,
        stdout
      });
    });
  });

const ensureEnvFile = () => {
  if (existsSync(envPath)) {
    log(".env found.");
    return;
  }

  if (!existsSync(envExamplePath)) {
    fail(".env is missing and .env.example was not found.");
  }

  copyFileSync(envExamplePath, envPath);
  log(`Created .env from ${envExampleFile}.`);
};

const parseEnvFile = () => {
  if (!existsSync(envPath)) {
    return {};
  }

  return Object.fromEntries(
    readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        const key = line.slice(0, separatorIndex).trim();
        const rawValue = line.slice(separatorIndex + 1).trim();
        const value = rawValue.replace(/^["']|["']$/g, "");

        return [key, value];
      })
  );
};

const isPlaceholderValue = (value) =>
  typeof value === "string" &&
  (value.trim() === "" ||
    value.toLowerCase().includes("your-") ||
    value.includes("USER:PASSWORD") ||
    value.includes("PROJECT.neon.tech") ||
    value.includes("PROJECT.supabase.co"));

const validateModeEnv = (env) => {
  if (isPlaceholderValue(env.DATABASE_URL)) {
    fail(
      [
        "DATABASE_URL still contains a placeholder.",
        `Update .env with a real database URL, then rerun ${env.AI_PROVIDER === "gemini" ? "`npm run dev:hosted`" : "`npm run dev`"}.`
      ].join("\n")
    );
  }

  if ((env.AI_PROVIDER ?? "").toLowerCase() === "gemini" && isPlaceholderValue(env.GEMINI_API_KEY)) {
    fail("GEMINI_API_KEY still contains a placeholder. Add a real Gemini API key to .env.");
  }

  if (
    (env.ATTACHMENT_STORAGE_PROVIDER ?? "auto").toLowerCase() === "r2" &&
    [env.R2_ENDPOINT, env.R2_BUCKET, env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY].some(isPlaceholderValue)
  ) {
    fail("ATTACHMENT_STORAGE_PROVIDER=r2 requires real R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY values.");
  }
};

const parseDatabaseUrl = (databaseUrl) => {
  try {
    return new URL(databaseUrl);
  } catch {
    fail(`DATABASE_URL is not a valid URL: ${databaseUrl}`);
  }
};

const isLocalDatabaseUrl = (databaseUrl) => {
  const parsedUrl = parseDatabaseUrl(databaseUrl);
  return ["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname);
};

const getDatabaseName = (databaseUrl) => {
  const parsedUrl = parseDatabaseUrl(databaseUrl);
  const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ""));

  if (!databaseName) {
    fail("DATABASE_URL must include a database name, for example `/node_based_chat`.");
  }

  return databaseName;
};

const quoteIdentifier = (identifier) => `"${identifier.replace(/"/g, "\"\"")}"`;

const getMaintenanceDatabaseUrl = (databaseUrl) => {
  const parsedUrl = parseDatabaseUrl(databaseUrl);
  parsedUrl.pathname = "/postgres";
  return parsedUrl.toString();
};

const getConnectionHint = (databaseUrl) => {
  const parsedUrl = parseDatabaseUrl(databaseUrl);
  const host = parsedUrl.hostname || "localhost";
  const port = parsedUrl.port || "5432";
  const user = decodeURIComponent(parsedUrl.username || "postgres");
  const databaseName = getDatabaseName(databaseUrl);

  return [
    `Native Postgres is expected at ${host}:${port}.`,
    "Install and start PostgreSQL, then enable passwordless local auth or update DATABASE_URL.",
    process.platform === "win32"
      ? "Windows setup helper: run PowerShell as Administrator, then run `npm run setup:postgres:windows`."
      : "Install Postgres with your system package manager, then make sure it is running.",
    `Expected local URL: postgres://${user}@${host}:${port}/${databaseName}`,
    "Quick test: psql postgres://postgres@localhost:5432/postgres"
  ].join("\n");
};

const connectToDatabase = async (databaseUrl) => {
  const client = new Client({
    connectionString: databaseUrl
  });

  try {
    await client.connect();
    await client.query("select 1");
  } finally {
    await client.end().catch(() => {});
  }
};

const createLocalDatabase = async (databaseUrl) => {
  const databaseName = getDatabaseName(databaseUrl);
  const maintenanceDatabaseUrl = getMaintenanceDatabaseUrl(databaseUrl);
  const client = new Client({
    connectionString: maintenanceDatabaseUrl
  });

  try {
    await client.connect();
    await client.query(`create database ${quoteIdentifier(databaseName)}`);
    log(`Created local Postgres database "${databaseName}".`);
  } catch (error) {
    if (error?.code === "42P04") {
      log(`Local Postgres database "${databaseName}" already exists.`);
      return;
    }

    throw error;
  } finally {
    await client.end().catch(() => {});
  }
};

const explainPostgresError = (databaseUrl, error) => {
  if (error?.code === "ECONNREFUSED") {
    return getConnectionHint(databaseUrl);
  }

  if (error?.code === "28P01") {
    return [
      "Postgres rejected the connection password.",
      "For passwordless local auth, remove the password from DATABASE_URL and allow trusted local connections.",
      process.platform === "win32"
        ? "Windows setup helper: run PowerShell as Administrator, then run `npm run setup:postgres:windows`."
        : "Update your Postgres auth config for trusted local connections, then restart Postgres.",
      "Example: DATABASE_URL=postgres://postgres@localhost:5432/node_based_chat"
    ].join("\n");
  }

  if (error?.code === "28000") {
    return [
      "Postgres rejected the local auth method.",
      "Enable passwordless local auth for your local user or set DATABASE_URL to a user/password that works.",
      process.platform === "win32"
        ? "Windows setup helper: run PowerShell as Administrator, then run `npm run setup:postgres:windows`."
        : "Update your Postgres auth config for trusted local connections, then restart Postgres."
    ].join("\n");
  }

  return error instanceof Error ? error.message : "Postgres connection failed.";
};

const ensurePostgres = async (env) => {
  const databaseUrl = env.DATABASE_URL || defaultDatabaseUrl;

  try {
    await connectToDatabase(databaseUrl);
    log("Native Postgres is ready.");
    return;
  } catch (error) {
    if (error?.code !== "3D000" || !isLocalDatabaseUrl(databaseUrl)) {
      fail(explainPostgresError(databaseUrl, error));
    }
  }

  log(`Local database "${getDatabaseName(databaseUrl)}" does not exist yet.`);

  try {
    await createLocalDatabase(databaseUrl);
    await connectToDatabase(databaseUrl);
    log("Native Postgres is ready.");
  } catch (error) {
    fail(explainPostgresError(databaseUrl, error));
  }
};

const runMigrations = async () => {
  log("Running database migrations...");
  const result = await run("npm", ["run", "db:migrate"]);

  if (result.code !== 0) {
    fail("Database migration failed while running `npm run db:migrate`.");
  }

  log("Database migrations applied.");
};

const checkOllama = async (env) => {
  if ((env.AI_PROVIDER ?? "").toLowerCase() !== "ollama") {
    log("AI_PROVIDER is not ollama; skipping Ollama check.");
    return;
  }

  const baseUrl = env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const tagsUrl = `${baseUrl.replace(/\/+$/, "")}/api/tags`;

  try {
    const response = await fetch(tagsUrl);

    if (!response.ok) {
      warn(`Ollama responded with HTTP ${response.status}. Start Ollama, then rerun if local models are needed.`);
      return;
    }

    const payload = await response.json();
    const models = Array.isArray(payload.models) ? payload.models : [];
    const gemmaModels = models
      .map((model) => model.name || model.model)
      .filter((name) => typeof name === "string" && name.toLowerCase().startsWith("gemma4:"));

    if (gemmaModels.length === 0) {
      warn("Ollama is running, but no local Gemma 4 models were found.");
      warn("Install the recommended local model with: `ollama pull gemma4:e4b`");
      return;
    }

    log(`Ollama Gemma 4 models found: ${gemmaModels.join(", ")}`);
  } catch {
    warn(`Ollama is not reachable at ${baseUrl}.`);
    warn("Start Ollama and install a model with: `ollama pull gemma4:e4b`");
  }
};

const main = async () => {
  log("Preparing local development environment...");
  ensureEnvFile();
  const env = parseEnvFile();
  validateModeEnv(env);

  await ensurePostgres(env);
  await runMigrations();

  if (skipOllamaCheck) {
    log("Skipping Ollama check.");
  } else {
    await checkOllama(env);
  }

  log("Preflight complete. Starting app...");
};

main().catch((error) => {
  fail(error instanceof Error ? error.message : "Local preflight failed.");
});
