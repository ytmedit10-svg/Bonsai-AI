import assert from "node:assert/strict";

import { buildPartialSplitMessage } from "./path-service.js";
import {
  buildRegeneratedAssistantContentJson,
  buildSelectedAssistantVariantContentJson,
  getAssistantLineage
} from "./message-service.js";

const sourceUserMessageId = "11111111-1111-1111-1111-111111111111";

const firstLineageJson = buildRegeneratedAssistantContentJson({
  content: "Second answer with more detail.",
  contextBundle: {
    droppedItems: [],
    estimatedTokens: 124,
    memories: [{ id: "memory-1" }],
    recentMessages: 4
  },
  existingContentJson: null,
  existingMessage: {
    contentText: "First answer.",
    createdAt: new Date("2026-05-05T10:00:00.000Z"),
    modelName: "gemini-2.5-flash",
    modelProvider: "google"
  },
  messageId: "22222222-2222-2222-2222-222222222222",
  modelName: "gemini-2.5-flash",
  modelProvider: "google",
  modelRunId: "33333333-3333-3333-3333-333333333333",
  sourceUserMessageId
});

const firstLineage = getAssistantLineage(firstLineageJson);
assert.ok(firstLineage, "regeneration should create lineage metadata");
assert.equal(firstLineage.currentVariantNo, 2);
assert.equal(firstLineage.variants.length, 2);
assert.equal(firstLineage.variants[0]?.contentText, "First answer.");
assert.equal(firstLineage.variants[1]?.contentText, "Second answer with more detail.");
assert.equal(firstLineage.variants[1]?.modelRunId, "33333333-3333-3333-3333-333333333333");
assert.equal(firstLineage.variants[1]?.sourceUserMessageId, sourceUserMessageId);

const secondLineageJson = buildRegeneratedAssistantContentJson({
  content: "Third answer, shorter.",
  contextBundle: {
    droppedItems: [{ reason: "budget" }],
    estimatedTokens: 140,
    memories: [{ id: "memory-1" }, { id: "memory-2" }],
    recentMessages: 5
  },
  existingContentJson: firstLineageJson,
  existingMessage: {
    contentText: "Second answer with more detail.",
    createdAt: new Date("2026-05-05T10:01:00.000Z"),
    modelName: "gemini-2.5-flash",
    modelProvider: "google"
  },
  messageId: "22222222-2222-2222-2222-222222222222",
  modelName: "gemini-2.5-flash",
  modelProvider: "google",
  modelRunId: "44444444-4444-4444-4444-444444444444",
  sourceUserMessageId
});

const secondLineage = getAssistantLineage(secondLineageJson);
assert.ok(secondLineage, "subsequent regeneration should preserve lineage");
assert.equal(secondLineage.currentVariantNo, 3);
assert.equal(secondLineage.variants.length, 3);
assert.equal(
  secondLineage.variantGroupId,
  firstLineage.variantGroupId,
  "regenerations should stay in the same variant group"
);

const selectedFirst = buildSelectedAssistantVariantContentJson({
  existingContentJson: secondLineageJson,
  variantNo: 1
});
assert.ok(selectedFirst, "existing variant should be selectable");
assert.equal(selectedFirst.selectedVariant.contentText, "First answer.");
assert.equal(
  getAssistantLineage(selectedFirst.contentJson)?.currentVariantNo,
  1,
  "variant selection should update the current visible variant"
);

const selectedThird = buildSelectedAssistantVariantContentJson({
  existingContentJson: secondLineageJson,
  variantNo: 3
});
assert.ok(selectedThird, "latest variant should be selectable");

const branchSnapshotMessage = buildPartialSplitMessage(
  {
    contentText: selectedThird.selectedVariant.contentText,
    role: "assistant"
  },
  "Third answer".length
);
assert.equal(
  branchSnapshotMessage.contentText,
  "Third answer",
  "branch snapshots should slice the currently selected assistant variant text"
);

const missingVariant = buildSelectedAssistantVariantContentJson({
  existingContentJson: secondLineageJson,
  variantNo: 99
});
assert.equal(missingVariant, null);

console.log("message-lineage tests passed");
