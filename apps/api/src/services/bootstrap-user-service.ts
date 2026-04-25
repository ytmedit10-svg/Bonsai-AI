import { eq } from "drizzle-orm";

import { loadEnv } from "../config/env.js";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";

const env = loadEnv();

export const ensureBootstrapUser = async () => {
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, env.DEV_BOOTSTRAP_USER_EMAIL)
  });

  if (existingUser) {
    return existingUser;
  }

  const [createdUser] = await db
    .insert(users)
    .values({
      email: env.DEV_BOOTSTRAP_USER_EMAIL,
      name: env.DEV_BOOTSTRAP_USER_NAME
    })
    .returning();

  return createdUser;
};

