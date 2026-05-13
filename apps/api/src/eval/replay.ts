import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.AI_PROVIDER = "mock";
process.env.API_ADMIN_KEY ??= "eval-admin-key";
process.env.COMPACTION_KEEP_RECENT_MESSAGES ??= "1";
process.env.COMPACTION_TRIGGER_MESSAGES ??= "1";
process.env.DEV_BOOTSTRAP_USER_EMAIL ??= "eval-replay@nodebasedchat.local";
process.env.DEV_BOOTSTRAP_USER_NAME ??= "Eval Replay";

type Fixture = {
  branch: {
    focusText: string;
    pathType: "chat" | "research" | "brainstorm" | "critique" | "planner" | "writer" | "merge";
    title: string;
  };
  branchPrompt: string;
  conversationTitle: string;
  mainPrompt: string;
  mergeMode: "light" | "full" | "reference" | "collapse";
  name: string;
};

type ConversationCreateResponse = {
  conversation: {
    id: string;
  };
  mainPath: {
    id: string;
  };
};

type Message = {
  contentJson?: Record<string, unknown> | null;
  contentText: string;
  id: string;
  modelName: string | null;
  modelProvider: string | null;
  role: string;
  status: string;
};

type StreamCompletedPayload = {
  assistantMessage: Message | null;
  path: {
    pathId: string;
  };
  userMessage: Message;
};

type BranchCreateResponse = {
  path: {
    id: string;
    parentPathId: string | null;
  };
  snapshot: {
    id: string;
    snapshotText: string;
  };
};

type ContextPreviewResponse = {
  context: {
    activeCompaction?: unknown;
    droppedItems: Array<{
      kind: string;
      reason: string;
    }>;
    estimatedTokens: number;
    retrievalCandidates: Array<{
      channels: string[];
      sourceId: string;
      sourceType: string;
    }>;
    recentMessages: number;
    sources: Array<{
      sourceId: string;
      sourceType: string;
    }>;
  };
  memories: {
    compaction: unknown | null;
  };
  retrievalCandidates: Array<{
    sourceId: string;
    sourceType: string;
  }>;
};

type MergeResponse = {
  artifact: {
    id: string;
  } | null;
  merge: {
    id: string;
    status: string;
  };
};

type SearchResponse = {
  results: Array<{
    conversationId: string;
    pathId: string | null;
    sourceId: string;
    sourceType: string;
  }>;
};

type SemanticRetrievalResult = {
  sourceId: string;
  sourceType: string;
};

type RunDetailResponse = {
  contextBundle: unknown;
  requestPayload: unknown;
  responsePayload: unknown;
  run: {
    id: string;
  };
};

type SseEvent = {
  data: unknown;
  event: string;
};

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const fixtureFiles = ["core-workflow.json"];

const loadFixture = async (filename: string) => {
  const fixturePath = path.join(currentDir, "fixtures", filename);
  return JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
};

const parseSseEvents = (body: string): SseEvent[] =>
  body
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const event =
        lines.find((line) => line.startsWith("event:"))?.slice("event:".length).trim() ??
        "message";
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .join("\n");

      return {
        data: JSON.parse(data),
        event
      };
    });

const postJson = async <T>({
  baseUrl,
  body,
  path: requestPath
}: {
  baseUrl: string;
  body: unknown;
  path: string;
}) => {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    assert.fail(
      `${requestPath} should succeed, got ${response.status}: ${await response.text()}`
    );
  }

  return (await response.json()) as T;
};

const getJson = async <T>(baseUrl: string, requestPath: string) => {
  const response = await fetch(`${baseUrl}${requestPath}`);

  if (!response.ok) {
    assert.fail(
      `${requestPath} should succeed, got ${response.status}: ${await response.text()}`
    );
  }

  return (await response.json()) as T;
};

const getAdminJson = async <T>(baseUrl: string, requestPath: string) => {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    headers: {
      "X-Admin-Key": process.env.API_ADMIN_KEY ?? ""
    }
  });

  if (!response.ok) {
    assert.fail(
      `${requestPath} should succeed, got ${response.status}: ${await response.text()}`
    );
  }

  return (await response.json()) as T;
};

const streamPost = async ({
  baseUrl,
  body,
  path: requestPath
}: {
  baseUrl: string;
  body?: unknown;
  path: string;
}) => {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers:
      body === undefined
        ? undefined
        : {
            "Content-Type": "application/json"
          },
    method: "POST"
  });

  if (!response.ok) {
    assert.fail(
      `${requestPath} should stream successfully, got ${response.status}: ${await response.text()}`
    );
  }

  const events = parseSseEvents(await response.text());
  const completed = events.find((event) => event.event === "message.completed");
  assert.ok(completed, `${requestPath} should emit message.completed`);

  return {
    completed: completed.data as StreamCompletedPayload,
    events
  };
};

const getLineage = (message: Message) => {
  const lineage = message.contentJson?.lineage;

  if (!lineage || typeof lineage !== "object" || Array.isArray(lineage)) {
    return null;
  }

  return lineage as {
    currentVariantNo: number;
    variants: unknown[];
  };
};

const getSources = (message: Message) => {
  const sources = message.contentJson?.sources;

  return Array.isArray(sources) ? sources : [];
};

const assertValidSources = (message: Message, label: string) => {
  const sources = getSources(message);

  assert.ok(sources.length > 0, `${label} should persist source references`);

  sources.forEach((source, index) => {
    assert.ok(
      source && typeof source === "object" && !Array.isArray(source),
      `${label} source ${index + 1} should be an object`
    );

    const value = source as Record<string, unknown>;
    assert.equal(typeof value.conversationId, "string", `${label} source needs conversationId`);
    assert.equal(typeof value.label, "string", `${label} source needs label`);
    assert.ok(
      typeof value.pathId === "string" || value.pathId === null,
      `${label} source needs nullable pathId`
    );
    assert.equal(typeof value.sourceId, "string", `${label} source needs sourceId`);
    assert.equal(typeof value.sourceType, "string", `${label} source needs sourceType`);
  });
};

const runFixture = async ({
  baseUrl,
  fixture
}: {
  baseUrl: string;
  fixture: Fixture;
}) => {
  const {
    backfillConversationEmbeddings,
    db,
    ensureBootstrapUser,
    getSemanticRetrievalCandidates,
    maybeCompactPath,
    operators,
    schema
  } =
    await import("./runtime-imports.js");
  const user = await ensureBootstrapUser();
  let conversationId: string | null = null;

  try {
    const created = await postJson<ConversationCreateResponse>({
      baseUrl,
      body: {
        title: fixture.conversationTitle
      },
      path: "/conversations"
    });
    conversationId = created.conversation.id;

    const mainStream = await streamPost({
      baseUrl,
      body: {
        content: fixture.mainPrompt
      },
      path: `/paths/${created.mainPath.id}/messages/stream`
    });
    const mainAssistant = mainStream.completed.assistantMessage;
    assert.ok(mainAssistant, "main stream should create an assistant message");
    assert.equal(mainAssistant.status, "completed");
    assert.equal(mainAssistant.modelProvider, "mock");
    assert.match(mainAssistant.contentText, /Replay branch point/);
    assertValidSources(mainAssistant, "main assistant");
    assert.ok(
      getSources(mainAssistant).some(
        (source) =>
          typeof source === "object" &&
          source !== null &&
          "sourceId" in source &&
          source.sourceId === mainStream.completed.userMessage.id
      ),
      "main assistant should cite the source user message"
    );

    const [attachment] = await db
      .insert(schema.attachments)
      .values({
        byteSize: 128,
        conversationId: created.conversation.id,
        createdByUserId: user.id,
        kind: "file",
        mimeType: "text/plain",
        originalName: "replay verification evidence notes file.txt",
        pathId: created.mainPath.id,
        status: "uploaded",
        storageKey: `eval/${created.conversation.id}/replay-verification-evidence-notes.txt`,
        storageProvider: "r2"
      })
      .returning();
    assert.ok(attachment, "attachment fixture should be stored");

    const embeddingBackfill = await backfillConversationEmbeddings({
      conversationId: created.conversation.id,
      userId: user.id
    });
    assert.ok(embeddingBackfill, "embedding backfill should find the conversation");
    assert.ok(
      embeddingBackfill.indexed >= 3,
      "embedding backfill should index replay messages and attachment metadata"
    );
    const semanticResults = await getSemanticRetrievalCandidates({
      conversationId: created.conversation.id,
      limit: 5,
      query: "deterministic evaluation fixture verification",
      userId: user.id
    }) as SemanticRetrievalResult[];
    assert.ok(
      semanticResults.some((result) => result.sourceId === mainAssistant.id),
      "semantic retrieval should find a conceptually related replay answer"
    );
    const attachmentSemanticResults = await getSemanticRetrievalCandidates({
      conversationId: created.conversation.id,
      limit: 8,
      query: "uploaded evidence notes file",
      userId: user.id
    }) as SemanticRetrievalResult[];
    assert.ok(
      attachmentSemanticResults.some(
        (result) =>
          result.sourceId === attachment.id && result.sourceType === "attachment_text"
      ),
      "semantic retrieval should find attachment metadata"
    );

    const focusStart = mainAssistant.contentText.indexOf(fixture.branch.focusText);
    assert.notEqual(focusStart, -1, "mock answer should contain branch focus text");

    const branch = await postJson<BranchCreateResponse>({
      baseUrl,
      body: {
        pathType: fixture.branch.pathType,
        splitBlockEndOffset: focusStart + fixture.branch.focusText.length,
        splitBlockStartOffset: focusStart,
        splitBlockType: "paragraph",
        splitFocusText: fixture.branch.focusText,
        splitFromMessageId: mainAssistant.id,
        title: fixture.branch.title
      },
      path: `/paths/${created.mainPath.id}/branch`
    });
    assert.equal(branch.path.parentPathId, created.mainPath.id);
    assert.match(branch.snapshot.snapshotText, /Inherited branch snapshot/);

    const branchStream = await streamPost({
      baseUrl,
      body: {
        content: fixture.branchPrompt
      },
      path: `/paths/${branch.path.id}/messages/stream`
    });
    const branchAssistant = branchStream.completed.assistantMessage;
    assert.ok(branchAssistant, "branch stream should create an assistant message");
    assert.equal(branchAssistant.modelProvider, "mock");
    assertValidSources(branchAssistant, "branch assistant");
    assert.ok(
      getSources(branchAssistant).some(
        (source) =>
          typeof source === "object" &&
          source !== null &&
          "sourceType" in source &&
          source.sourceType === "branch_snapshot"
      ),
      "branch assistant should cite its inherited branch snapshot"
    );
    assert.ok(
      getSources(branchAssistant).some(
        (source) =>
          typeof source === "object" &&
          source !== null &&
          "sourceType" in source &&
          source.sourceType === "retrieval_result"
      ),
      "branch assistant should cite retrieved context"
    );

    const regenerationStream = await streamPost({
      baseUrl,
      path: `/paths/${branch.path.id}/messages/${branchAssistant.id}/regenerate/stream`
    });
    const regeneratedAssistant = regenerationStream.completed.assistantMessage;
    assert.ok(regeneratedAssistant, "regeneration should return assistant message");
    assertValidSources(regeneratedAssistant, "regenerated assistant");
    const lineage = getLineage(regeneratedAssistant);
    assert.ok(lineage, "regeneration should preserve variant lineage");
    assert.equal(lineage.currentVariantNo, 2);
    assert.equal(lineage.variants.length, 2);
    assert.ok(
      getSources(regeneratedAssistant).length > 0,
      "regenerated assistant should persist source references"
    );

    const compaction = await maybeCompactPath({
      pathId: branch.path.id,
      reason: "manual",
      userId: user.id
    });
    assert.equal(compaction.status, "compacted");
    assert.ok(compaction.artifact, "manual compaction should create an artifact");

    const context = await getJson<ContextPreviewResponse>(
      baseUrl,
      `/paths/${branch.path.id}/context`
    );
    assert.ok(context.memories.compaction, "context preview should include compaction");
    assert.ok(context.context.estimatedTokens > 0, "context should estimate tokens");
    assert.ok(
      Array.isArray(context.context.sources) && context.context.sources.length > 0,
      "context summary should expose source references"
    );
    assert.ok(
      Array.isArray(context.context.retrievalCandidates),
      "context summary should expose retrieval candidates"
    );
    assert.ok(
      Array.isArray(context.context.droppedItems),
      "context summary should expose dropped context"
    );

    const search = await getJson<SearchResponse>(
      baseUrl,
      `/search?q=${encodeURIComponent("Replay branch point")}&conversationId=${created.conversation.id}`
    );
    assert.ok(
      search.results.some(
        (result) => result.sourceType === "message" && result.sourceId === mainAssistant.id
      ),
      "search should find the main assistant message"
    );
    assert.ok(
      search.results.every((result) => result.conversationId === created.conversation.id),
      "search should respect conversation filters"
    );
    const attachmentSearch = await getJson<SearchResponse>(
      baseUrl,
      `/search?q=${encodeURIComponent("verification evidence notes")}&conversationId=${created.conversation.id}`
    );
    assert.ok(
      attachmentSearch.results.some(
        (result) => result.sourceType === "attachment" && result.sourceId === attachment.id
      ),
      "search should find attachment metadata"
    );

    const merge = await postJson<MergeResponse>({
      baseUrl,
      body: {
        acknowledgeOutdated: true,
        mergeMode: fixture.mergeMode,
        sourcePathId: branch.path.id,
        targetPathId: created.mainPath.id
      },
      path: "/merges"
    });
    assert.equal(merge.merge.status, "completed");
    assert.ok(merge.artifact, "merge should create a memory artifact");

    const runs = await db.query.modelRuns.findMany({
      where: operators.eq(schema.modelRuns.conversationId, created.conversation.id)
    });
    const completedRunTypes = new Set(
      runs
        .filter((run) => run.status === "completed")
        .map((run) => run.runType)
    );
    assert.ok(completedRunTypes.has("chat_response"), "chat run should complete");
    assert.ok(completedRunTypes.has("path_compaction"), "compaction run should complete");
    assert.ok(completedRunTypes.has("merge_generation"), "merge run should complete");
    assert.ok(
      runs.every((run) => run.modelProvider === "mock"),
      "replay should never call a live provider"
    );
    const chatRun = runs.find((run) => run.runType === "chat_response");
    assert.ok(chatRun, "replay should have a chat response run");
    const runDetail = await getAdminJson<RunDetailResponse>(
      baseUrl,
      `/admin/observability/runs/${chatRun.id}`
    );
    assert.equal(runDetail.run.id, chatRun.id);
    assert.ok(runDetail.contextBundle, "run detail should expose context bundle");
    assert.ok(runDetail.requestPayload, "run detail should expose request payload");

    console.log(
      `ok ${fixture.name}: ${runs.length} model runs, branch ${branch.path.id}, merge ${merge.merge.id}`
    );
  } finally {
    if (conversationId && process.env.EVAL_KEEP_REPLAY_DATA !== "true") {
      await db
        .delete(schema.conversations)
        .where(operators.eq(schema.conversations.id, conversationId));
    }
  }
};

const main = async () => {
  const [{ buildServer }, { pool }] = await Promise.all([
    import("../server.js"),
    import("../db/client.js")
  ]);
  const server = buildServer();

  try {
    const baseUrl = await server.listen({
      host: "127.0.0.1",
      port: 0
    });

    for (const fixtureFile of fixtureFiles) {
      await runFixture({
        baseUrl,
        fixture: await loadFixture(fixtureFile)
      });
    }
  } finally {
    await server.close();
    await pool.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
