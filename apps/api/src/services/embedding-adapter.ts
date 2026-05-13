import { loadEnv } from "../config/env.js";

const env = loadEnv();

const TOKEN_PATTERN = /[a-z0-9]+/g;

const semanticExpansions: Record<string, string[]> = {
  branch: ["fork", "split", "path", "variant"],
  context: ["memory", "prompt", "history", "state"],
  eval: ["evaluation", "replay", "test", "verification"],
  memory: ["context", "summary", "artifact", "remember"],
  replay: ["deterministic", "eval", "fixture", "verification"],
  retrieval: ["search", "memory", "recall", "context"],
  search: ["retrieval", "find", "lookup", "discover"],
  semantic: ["meaning", "concept", "related", "retrieval"],
  verify: ["verification", "test", "check", "validate"],
  verification: ["verify", "test", "check", "replay"]
};

const hashString = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

const stemToken = (token: string) =>
  token
    .replace(/(ingly|edly|ation|ments|ment|ness|able|ible)$/u, "")
    .replace(/(ing|ers|ies|ied|ed|er|es|s)$/u, "");

const tokenize = (content: string) => {
  const rawTokens = content.toLowerCase().match(TOKEN_PATTERN) ?? [];
  const tokens: string[] = [];

  rawTokens.forEach((token) => {
    if (token.length < 2) {
      return;
    }

    const stemmed = stemToken(token);
    tokens.push(token, stemmed);
    tokens.push(...(semanticExpansions[token] ?? []));
    tokens.push(...(semanticExpansions[stemmed] ?? []));
  });

  for (let index = 0; index < rawTokens.length - 1; index += 1) {
    tokens.push(`${rawTokens[index]}_${rawTokens[index + 1]}`);
  }

  return tokens;
};

const normalizeVector = (vector: number[]) => {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  if (magnitude === 0) {
    return vector;
  }

  return vector.map((value) => Number((value / magnitude).toFixed(8)));
};

export const getEmbeddingProfile = () => ({
  dimensions: env.EMBEDDING_DIMENSIONS,
  model: env.EMBEDDING_MODEL
});

export const embedText = async (content: string) => {
  const { dimensions, model } = getEmbeddingProfile();
  const vector = Array.from({ length: dimensions }, () => 0);
  const tokens = tokenize(content);

  tokens.forEach((token) => {
    const hash = hashString(token);
    const index = hash % dimensions;
    const sign = hash & 1 ? 1 : -1;
    vector[index] += sign;
  });

  return {
    dimensions,
    model,
    vector: normalizeVector(vector)
  };
};

export const cosineSimilarity = (left: number[], right: number[]) => {
  const length = Math.min(left.length, right.length);
  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dotProduct += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dotProduct / Math.sqrt(leftMagnitude * rightMagnitude);
};
