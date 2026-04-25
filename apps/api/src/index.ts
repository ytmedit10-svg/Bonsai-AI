import { buildServer } from "./server.js";
import { loadEnv } from "./config/env.js";

const start = async () => {
  const env = loadEnv();
  const server = buildServer();

  try {
    await server.listen({
      host: env.API_HOST,
      port: env.API_PORT
    });

    server.log.info(
      `${env.APP_NAME} API listening on http://${env.API_HOST}:${env.API_PORT}`
    );
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
};

start();

