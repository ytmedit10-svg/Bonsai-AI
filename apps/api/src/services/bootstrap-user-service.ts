import type { FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";

import { loadEnv } from "../config/env.js";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";

const env = loadEnv();
const anonymousUserHeader = "x-anonymous-user-id";

const anonymousUserIdSchema =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const sanitizeUserName = (userId: string) => `Demo User ${userId.slice(0, 8)}`;

const getAnonymousUserId = (request: FastifyRequest) => {
  const rawValue = request.headers[anonymousUserHeader];
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return anonymousUserIdSchema.test(normalized) ? normalized : null;
};

const ensureUserByEmail = async ({
  email,
  name
}: {
  email: string;
  name: string;
}) => {
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, email)
  });

  if (existingUser) {
    return existingUser;
  }

  const [createdUser] = await db
    .insert(users)
    .values({
      email,
      name
    })
    .onConflictDoNothing({
      target: users.email
    })
    .returning();

  if (createdUser) {
    return createdUser;
  }

  const user = await db.query.users.findFirst({
    where: eq(users.email, email)
  });

  if (!user) {
    throw new Error("Could not create or resolve request user.");
  }

  return user;
};

export const ensureBootstrapUser = async () => {
  return ensureUserByEmail({
    email: env.DEV_BOOTSTRAP_USER_EMAIL,
    name: env.DEV_BOOTSTRAP_USER_NAME
  });
};

export const ensureRequestUser = async (request: FastifyRequest) => {
  const anonymousUserId = getAnonymousUserId(request);

  if (!anonymousUserId) {
    return ensureBootstrapUser();
  }

  return ensureUserByEmail({
    email: `anon-${anonymousUserId}@nodebasedchat.local`,
    name: sanitizeUserName(anonymousUserId)
  });
};
