import {
  Suspense,
  cloneElement,
  isValidElement,
  lazy,
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { APP_NAME } from "@node-based-chat/shared";

type Conversation = {
  id: string;
  pinnedAt?: string | null;
  title: string;
  mainPathId: string | null;
};

type BranchPathType =
  | "chat"
  | "research"
  | "brainstorm"
  | "critique"
  | "planner"
  | "writer"
  | "merge";

type MergeMode = "light" | "full" | "reference" | "collapse";

type ConversationPath = {
  id: string;
  title: string;
  isMain: boolean;
  parentPathId: string | null;
  splitFromMessageId: string | null;
  splitBlockStartOffset: number | null;
  splitBlockEndOffset: number | null;
  splitBlockType: string | null;
  splitFocusText: string | null;
  splitMessageCreatedAt: string | null;
  splitMessagePreview: string | null;
  splitMessageSequenceNo: number | null;
  depth: number;
  pathType: string;
  createdAt: string;
};

type PathSummary = {
  conversationId: string;
  depth: number;
  isMain: boolean;
  parentPathId: string | null;
  pathId: string;
  pathTitle: string;
  splitFromMessageId: string | null;
};

type PathSnapshot = {
  id: string;
  snapshotText: string;
  sourceMessageId: string | null;
  sourcePathId: string;
};

type PathProvenance = {
  parentPath: {
    id: string;
    title: string;
  } | null;
  splitMessage: {
    id: string;
    role: "user" | "assistant" | "system" | "tool";
    sequenceNo: number;
    contentPreview: string;
    createdAt: string;
    splitBlockStartOffset: number | null;
    splitBlockEndOffset: number | null;
    splitBlockType: string | null;
    splitFocusText: string | null;
  } | null;
};

type Message = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  contentJson?: Record<string, unknown> | null;
  messageType?: string;
  contentText: string;
  createdAt: string;
  modelName: string | null;
};

type MemoryArtifact = {
  id: string;
  artifactType: string;
  contentText: string;
  createdAt: string;
  pathId: string;
  visibility: string;
};

type MergeRecord = {
  id: string;
  conversationId: string;
  sourcePathId: string;
  targetPathId: string;
  mergeMode: MergeMode;
  status: string;
  resultArtifactId: string | null;
  resultMessageId: string | null;
  errorText: string | null;
  createdAt: string;
  completedAt: string | null;
  sourcePath?: {
    id: string;
    title: string;
  } | null;
  targetPath?: {
    id: string;
    title: string;
  } | null;
};

type ConversationCreateResponse = {
  conversation: Conversation;
  mainPath: {
    id: string;
    title: string;
  };
};

type PathMessagesResponse = {
  path: PathSummary;
  provenance: PathProvenance;
  snapshot: PathSnapshot | null;
  messages: Message[];
};

type ConversationPathsResponse = {
  conversation: Conversation;
  paths: ConversationPath[];
};

type ConversationViewStateResponse = {
  conversationId: string;
  lastActivePathId: string | null;
  updatedAt: string | null;
};

type BranchCreateResponse = {
  path: ConversationPath;
  snapshot: PathSnapshot;
};

type CompletedStreamPayload = {
  assistantMessage: Message | null;
  conversationTitle?: string | null;
  path: PathSummary;
  userMessage: Message;
};

type MergeResponse = {
  merge: MergeRecord;
  artifact: MemoryArtifact | null;
  mainMessage: Message | null;
  sourcePath: {
    id: string;
    title: string;
  } | null;
  targetPath: {
    id: string;
    title: string;
  } | null;
};

type MergeConfirmationResponse = {
  reason: "main_moved_forward";
  requiresConfirmation: true;
  sourcePath: {
    id: string;
    title: string;
  };
  targetPath: {
    id: string;
    title: string;
  };
};

type ConversationMergesResponse = {
  conversation: Conversation;
  merges: Array<{
    merge: MergeRecord;
    artifact: MemoryArtifact | null;
  }>;
};

type ObservabilitySummaryResponse = {
  runs: {
    total: number;
    completed: number;
    failed: number;
  };
  tokens: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    estimatedCostUsd: number;
  };
  cache: {
    explicitRuns: number;
    hitRate: number;
  };
  latency: {
    p50Ms: number;
    p95Ms: number;
  };
  cost: {
    estimatedUsd: number;
  };
};

type ModelRunRecord = {
  id: string;
  runType: string;
  status: string;
  modelProvider: string;
  modelName: string;
  cacheMode: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  estimatedCostUsd: string | number | null;
  latencyMs: number | null;
  createdAt: string;
  errorText: string | null;
};

type ObservabilityRunsResponse = {
  runs: ModelRunRecord[];
};

type BranchDraft = {
  focusText: string;
  pathType: BranchPathType;
  splitBlockStartOffset: number;
  splitBlockEndOffset: number;
  splitBlockType: string;
  splitFromMessageId: string;
  targetId: string;
  title: string;
};

type RecentChat = {
  conversationId: string;
  mainPathId: string | null;
  pinnedAt: string | null;
  preview: string;
  title: string;
  updatedAt: string;
};

type ConversationListResponse = {
  conversations: RecentChat[];
};

type ConversationUpdateResponse = {
  conversation: Conversation;
};

type ConversationShareResponse = {
  sharePath: string;
  shareUrl: string;
  share: {
    token: string;
    createdAt: string;
  };
};

type SharedConversationResponse = {
  conversation: Conversation;
  messagesByPathId: Record<string, Message[]>;
  paths: ConversationPath[];
  share: {
    token: string;
    createdAt: string;
  };
};

type SidebarMenuState = {
  chat: RecentChat;
  x: number;
  y: number;
};

type ConversationViewState = {
  lastActivePathId?: string;
};

type ConversationViewStateMap = Record<string, ConversationViewState>;

const MERGE_REQUEST_TIMEOUT_MS = 90000;
const VIEW_STATE_SAVE_DEBOUNCE_MS = 250;
const RECENT_CHATS_STORAGE_KEY = "node-based-chat.recent-chats";
const CONVERSATION_VIEW_STATE_STORAGE_KEY = "node-based-chat.conversation-view-state";
const ADMIN_KEY_STORAGE_KEY = "node-based-chat.admin-key";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "node-based-chat.sidebar-collapsed";
const DEFAULT_MERGE_MODE: MergeMode = "collapse";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:4000";
const ENABLE_ADMIN_UI =
  import.meta.env.VITE_ENABLE_ADMIN_UI?.trim().toLowerCase() === "true";

const isPhoneViewport = () =>
  typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches;

const OPTIMISTIC_MODEL_NAME =
  import.meta.env.VITE_AI_DEFAULT_MODEL?.trim() ||
  import.meta.env.VITE_GROQ_DEFAULT_MODEL?.trim() ||
  import.meta.env.VITE_GEMINI_DEFAULT_MODEL?.trim() ||
  "llama-3.1-8b-instant";

const BranchGraph = lazy(async () => {
  const module = await import("./graph/BranchGraph");
  return { default: module.BranchGraph };
});

const QUICK_PROMPTS = [
  "Help me plan a product launch",
  "Write a polished email reply",
  "Brainstorm startup ideas"
] as const;

// Branch modes are parked until they drive real mode-specific system prompts.
// Keeping the options here preserves the product direction without exposing a
// selector that currently behaves like a cosmetic label.
const PARKED_BRANCH_TYPE_OPTIONS: Array<{
  value: BranchPathType;
  label: string;
  description: string;
}> = [
  {
    value: "chat",
    label: "Chat",
    description: "General continuation from the split point."
  },
  {
    value: "research",
    label: "Research",
    description: "Explore facts, evidence, and deeper analysis."
  },
  {
    value: "brainstorm",
    label: "Brainstorm",
    description: "Generate many possible directions quickly."
  },
  {
    value: "critique",
    label: "Critique",
    description: "Stress-test the idea and identify weaknesses."
  },
  {
    value: "planner",
    label: "Planner",
    description: "Turn the branch into structured next steps."
  },
  {
    value: "writer",
    label: "Writer",
    description: "Use the branch for drafting or rewriting output."
  },
  {
    value: "merge",
    label: "Merge Prep",
    description: "Prepare a branch specifically for later merge work."
  }
];

const MERGE_MODE_OPTIONS: Array<{
  value: MergeMode;
  label: string;
  description: string;
}> = [
  {
    value: "light",
    label: "Light Merge",
    description: "Compact memory for the main path with key takeaways and open questions."
  },
  {
    value: "full",
    label: "Full Merge",
    description: "Richer artifact with more structure, detail, and preserved nuance."
  },
  {
    value: "reference",
    label: "Reference Merge",
    description: "Short reference-style memory for quick recall later on main."
  },
  {
    value: "collapse",
    label: "Collapse Merge",
    description: "Write the result as if main absorbed the branch's important learning."
  }
];

const createOptimisticId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2)}-${Date.now()}`;

class MergeRequiresConfirmationError extends Error {
  confirmation: MergeConfirmationResponse;

  constructor(confirmation: MergeConfirmationResponse) {
    super("Main has moved forward since this branch was created.");
    this.name = "MergeRequiresConfirmationError";
    this.confirmation = confirmation;
  }
}

const normalizeChatText = (value: string) => value.replace(/\s+/g, " ").trim();

const truncateText = (value: string, maxLength: number) => {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
};

const SidebarIcon = ({
  name
}: {
  name: "brand" | "collapse" | "new" | "search";
}) => {
  if (name === "brand") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 2.75 5.85 6.3v7.1L12 16.95l6.15-3.55V6.3L12 2.75Z" />
        <path d="m7.95 7.5 4.05-2.34 4.05 2.34v4.68L12 14.52l-4.05-2.34V7.5Z" />
        <path d="M12 21.25 5.85 17.7M12 21.25l6.15-3.55M5.85 17.7 12 14.15l6.15 3.55" />
      </svg>
    );
  }

  if (name === "collapse") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <rect x="4" y="4" width="16" height="16" rx="4" />
        <path d="M12 5v14" />
      </svg>
    );
  }

  if (name === "new") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 5H7a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h9a3 3 0 0 0 3-3v-5" />
        <path d="M14 4h6v6" />
        <path d="m11 13 8.5-8.5" />
      </svg>
    );
  }

  if (name === "search") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="10.75" cy="10.75" r="6.25" />
        <path d="m16 16 4.25 4.25" />
      </svg>
    );
  }

  return null;
};

const SendIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <path d="M12 19V5" />
    <path d="m6.5 10.5 5.5-5.5 5.5 5.5" />
  </svg>
);

const BranchActionIcon = () => (
  <svg aria-hidden="true" viewBox="3 2 18 19">
    <path d="M6 3v12" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="6" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
);

const extractNodeText = (value: ReactNode): string => {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (!value) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.map((item) => extractNodeText(item)).join(" ");
  }

  if (typeof value === "object" && "props" in value) {
    return extractNodeText((value as { props?: { children?: ReactNode } }).props?.children);
  }

  return "";
};

const appendInlineAction = (children: ReactNode, action: ReactNode): ReactNode => {
  if (!action) {
    return children;
  }

  if (Array.isArray(children)) {
    const nextChildren = [...children];

    for (let index = nextChildren.length - 1; index >= 0; index -= 1) {
      if (extractNodeText(nextChildren[index])) {
        nextChildren[index] = appendInlineAction(nextChildren[index], action);
        return nextChildren;
      }
    }

    return [...nextChildren, action];
  }

  if (isValidElement<{ children?: ReactNode }>(children)) {
    return cloneElement(children, {
      children: appendInlineAction(children.props.children, action)
    });
  }

  return (
    <>
      {children}
      {action}
    </>
  );
};

const createBranchTitleFromFocus = (focusText: string) => {
  const normalized = normalizeChatText(focusText);

  if (!normalized) {
    return "";
  }

  return truncateText(normalized, 44);
};

const isPlaceholderChatTitle = (title: string | null | undefined) => {
  const normalized = title?.trim().toLowerCase();

  return !normalized || normalized === "new chat" || normalized === "untitled chat";
};

const generateChatPreview = (messages: Message[]) => {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user" && normalizeChatText(message.contentText));

  if (!lastUserMessage) {
    return "Start the conversation to generate a title.";
  }

  return truncateText(normalizeChatText(lastUserMessage.contentText), 72);
};

const readRecentChats = (): RecentChat[] => {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(RECENT_CHATS_STORAGE_KEY);

    if (!rawValue) {
      return [];
    }

    const parsed = JSON.parse(rawValue) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(
        (item): item is RecentChat =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof item.conversationId === "string" &&
          (typeof item.mainPathId === "string" || item.mainPathId === null) &&
          typeof item.preview === "string" &&
          typeof item.title === "string" &&
          typeof item.updatedAt === "string"
      )
      .map((item) => ({
        ...item,
        pinnedAt: typeof item.pinnedAt === "string" ? item.pinnedAt : null
      }))
      .sort(
        (left, right) => {
          const pinDifference =
            Number(Boolean(right.pinnedAt)) - Number(Boolean(left.pinnedAt));

          if (pinDifference !== 0) {
            return pinDifference;
          }

          return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
        }
      );
  } catch {
    return [];
  }
};

const readConversationViewStates = (): ConversationViewStateMap => {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const rawValue = window.localStorage.getItem(CONVERSATION_VIEW_STATE_STORAGE_KEY);

    if (!rawValue) {
      return {};
    }

    const parsed = JSON.parse(rawValue) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const entries = Object.entries(parsed).flatMap(([conversationId, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return [];
      }

      const candidate = value as {
        lastActivePathId?: unknown;
      };

      return [
        [
          conversationId,
          {
            ...(typeof candidate.lastActivePathId === "string"
              ? { lastActivePathId: candidate.lastActivePathId }
              : {})
          }
        ] satisfies [string, ConversationViewState]
      ];
    });

    return Object.fromEntries(entries);
  } catch {
    return {};
  }
};

const writeConversationViewStates = (states: ConversationViewStateMap) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(CONVERSATION_VIEW_STATE_STORAGE_KEY, JSON.stringify(states));
};

const getLocalConversationViewState = (conversationId: string) =>
  readConversationViewStates()[conversationId] ?? {};

const updateConversationViewState = (
  conversationId: string,
  updater: (current: ConversationViewState) => ConversationViewState
) => {
  const states = readConversationViewStates();
  const nextState = updater(states[conversationId] ?? {});

  writeConversationViewStates({
    ...states,
    [conversationId]: nextState
  });
};

const upsertRecentChat = (currentChats: RecentChat[], nextChat: RecentChat) => {
  const nextChats = [
    nextChat,
    ...currentChats.filter((chat) => chat.conversationId !== nextChat.conversationId)
  ];

  return nextChats
    .sort((left, right) => {
      const pinDifference = Number(Boolean(right.pinnedAt)) - Number(Boolean(left.pinnedAt));

      if (pinDifference !== 0) {
        return pinDifference;
      }

      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    })
    .slice(0, 24);
};

const extractErrorMessage = async (response: Response) => {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { error?: string; message?: string };
    return payload.error ?? payload.message ?? "Request failed.";
  }

  const text = await response.text();
  return text || "Request failed.";
};

const normalizeProviderErrorMessage = (message: string) => {
  try {
    const parsedOuter = JSON.parse(message) as {
      error?: {
        message?: string;
      };
    };

    if (!parsedOuter.error?.message) {
      return message;
    }

    try {
      const parsedInner = JSON.parse(parsedOuter.error.message) as {
        error?: {
          message?: string;
        };
      };

      return parsedInner.error?.message ?? parsedOuter.error.message;
    } catch {
      return parsedOuter.error.message;
    }
  } catch {
    return message;
  }
};

const createConversation = async (title: string) => {
  const response = await fetch(`${API_BASE_URL}/conversations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ title })
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as ConversationCreateResponse;
};

const listConversations = async () => {
  const response = await fetch(`${API_BASE_URL}/conversations`);

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as ConversationListResponse;
};

const updateConversationRecord = async ({
  conversationId,
  pinned,
  title
}: {
  conversationId: string;
  pinned?: boolean;
  title?: string;
}) => {
  const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...(typeof pinned === "boolean" ? { pinned } : {}),
      ...(typeof title === "string" ? { title } : {})
    })
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as ConversationUpdateResponse;
};

const deleteConversationRecord = async (conversationId: string) => {
  const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
};

const shareConversation = async (conversationId: string) => {
  const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}/share`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as ConversationShareResponse;
};

const getSharedConversation = async (shareToken: string) => {
  const response = await fetch(`${API_BASE_URL}/shared/conversations/${shareToken}`);

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as SharedConversationResponse;
};

const getPathMessages = async (pathId: string) => {
  const response = await fetch(`${API_BASE_URL}/paths/${pathId}/messages`);

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as PathMessagesResponse;
};

const getConversationPaths = async (conversationId: string) => {
  const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}/paths`);

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as ConversationPathsResponse;
};

const getConversationMerges = async (conversationId: string) => {
  const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}/merges`);

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as ConversationMergesResponse;
};

const getServerConversationViewState = async (conversationId: string) => {
  const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}/view-state`);

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as ConversationViewStateResponse;
};

const updateServerConversationViewState = async ({
  conversationId,
  lastActivePathId
}: {
  conversationId: string;
  lastActivePathId: string | null;
}) => {
  const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}/view-state`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ lastActivePathId })
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as ConversationViewStateResponse;
};

const getMerge = async (mergeId: string) => {
  const response = await fetch(`${API_BASE_URL}/merges/${mergeId}`);

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as MergeResponse;
};

const getObservabilitySummary = async ({
  adminKey
}: {
  adminKey: string;
}) => {
  const response = await fetch(`${API_BASE_URL}/admin/observability/summary`, {
    headers: {
      "X-Admin-Key": adminKey
    }
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as ObservabilitySummaryResponse;
};

const getObservabilityRuns = async ({
  adminKey,
  limit,
  status
}: {
  adminKey: string;
  limit: number;
  status?: "completed" | "failed" | "queued" | "started";
}) => {
  const params = new URLSearchParams({
    limit: String(limit)
  });

  if (status) {
    params.set("status", status);
  }

  const response = await fetch(`${API_BASE_URL}/admin/observability/runs?${params.toString()}`, {
    headers: {
      "X-Admin-Key": adminKey
    }
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as ObservabilityRunsResponse;
};

const createBranch = async ({
  pathId,
  splitBlockEndOffset,
  splitBlockStartOffset,
  splitBlockType,
  splitFromMessageId,
  splitFocusText,
  title,
  pathType
}: {
  pathId: string;
  splitBlockEndOffset: number;
  splitBlockStartOffset: number;
  splitBlockType: string;
  splitFromMessageId: string;
  splitFocusText: string;
  title?: string;
  pathType: BranchPathType;
}) => {
  const response = await fetch(`${API_BASE_URL}/paths/${pathId}/branch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      pathType,
      title: title?.trim() || undefined,
      splitBlockEndOffset,
      splitBlockStartOffset,
      splitBlockType,
      splitFocusText,
      splitFromMessageId
    })
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as BranchCreateResponse;
};

const requestMerge = async ({
  acknowledgeOutdated,
  mergeMode,
  sourcePathId,
  targetPathId
}: {
  acknowledgeOutdated?: boolean;
  mergeMode: MergeMode;
  sourcePathId: string;
  targetPathId?: string;
}) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), MERGE_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}/merges`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        acknowledgeOutdated,
        mergeMode,
        sourcePathId,
        targetPathId
      })
    });

    if (response.status === 409) {
      const payload = (await response.json()) as MergeConfirmationResponse;
      throw new MergeRequiresConfirmationError(payload);
    }

    if (!response.ok) {
      throw new Error(await extractErrorMessage(response));
    }

    return (await response.json()) as MergeResponse;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        "Merge is taking too long. The model may be overloaded. Try again or use a lighter merge mode."
      );
    }

    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
};

const streamPathMessage = async (
  pathId: string,
  content: string,
  handlers: {
    onDelta: (text: string) => void;
    onCompleted: (payload: CompletedStreamPayload) => void;
  }
) => {
  const response = await fetch(`${API_BASE_URL}/paths/${pathId}/messages/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ content })
  });

  if (!response.ok || !response.body) {
    throw new Error(await extractErrorMessage(response));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let isCompleted = false;

  const getBoundaryIndex = (value: string) => {
    const unixBoundary = value.indexOf("\n\n");
    const windowsBoundary = value.indexOf("\r\n\r\n");

    if (unixBoundary === -1) {
      return windowsBoundary;
    }

    if (windowsBoundary === -1) {
      return unixBoundary;
    }

    return Math.min(unixBoundary, windowsBoundary);
  };

  const processBlock = (block: string) => {
    const lines = block.split(/\r?\n/);
    let eventName = "message";
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (dataLines.length === 0) {
      return;
    }

    const payload = JSON.parse(dataLines.join("\n")) as
      | { text?: string; error?: string }
      | CompletedStreamPayload;

    if (eventName === "message.delta" && "text" in payload && payload.text) {
      handlers.onDelta(payload.text);
      return;
    }

    if (eventName === "message.completed") {
      handlers.onCompleted(payload as CompletedStreamPayload);
      isCompleted = true;
      return;
    }

    if (eventName === "run.error") {
      const error = "error" in payload ? payload.error : "Streaming failed.";
      throw new Error(normalizeProviderErrorMessage(error || "Streaming failed."));
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    let boundaryIndex = getBoundaryIndex(buffer);

    while (boundaryIndex !== -1) {
      const block = buffer.slice(0, boundaryIndex).trim();
      const boundaryLength = buffer.startsWith("\r\n\r\n", boundaryIndex) ? 4 : 2;
      buffer = buffer.slice(boundaryIndex + boundaryLength);

      if (block) {
        processBlock(block);

        if (isCompleted) {
          await reader.cancel();
          return;
        }
      }

      boundaryIndex = getBoundaryIndex(buffer);
    }

    if (done) {
      const trailingBlock = buffer.trim();

      if (trailingBlock) {
        processBlock(trailingBlock);

        if (isCompleted) {
          return;
        }
      }

      break;
    }
  }

  if (!isCompleted) {
    throw new Error("Streaming ended before the assistant response completed.");
  }
};

const truncateSnapshot = (snapshot: string | null) => {
  if (!snapshot) {
    return null;
  }

  if (snapshot.length <= 280) {
    return snapshot;
  }

  return `${snapshot.slice(0, 280)}...`;
};

const formatRoleLabel = (role: NonNullable<PathProvenance["splitMessage"]>["role"]) =>
  `${role.slice(0, 1).toUpperCase()}${role.slice(1)}`;

const formatPathTypeLabel = (pathType: string) =>
  PARKED_BRANCH_TYPE_OPTIONS.find((option) => option.value === pathType)?.label ?? pathType;

const formatMergeModeLabel = (mergeMode: MergeMode) =>
  MERGE_MODE_OPTIONS.find((option) => option.value === mergeMode)?.label ?? mergeMode;

const formatTime = (value: string) =>
  new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString([], {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short"
  });

const getMergeIdFromMessage = (message: Message) => {
  const contentJson = message.contentJson;

  if (!contentJson || typeof contentJson !== "object") {
    return null;
  }

  const maybeMergeId = contentJson.mergeId;
  return typeof maybeMergeId === "string" ? maybeMergeId : null;
};

const getMergeSourceTitleFromMessage = (message: Message) => {
  const contentJson = message.contentJson;

  if (!contentJson || typeof contentJson !== "object") {
    return "Branch";
  }

  const maybeTitle = contentJson.sourcePathTitle;
  return typeof maybeTitle === "string" && maybeTitle.trim() ? maybeTitle : "Branch";
};

const MarkdownContent = ({
  className,
  content
}: {
  className?: string;
  content: string;
}) => (
  <div className={className}>
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
  </div>
);

const MergeMemoryCard = ({ message }: { message: Message }) => {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const mergeId = getMergeIdFromMessage(message);
  const sourceTitle = getMergeSourceTitleFromMessage(message);
  const detailContent = (() => {
    const sections = message.contentText.split(/\r?\n\r?\n/);

    if (sections.length <= 1) {
      return message.contentText;
    }

    return sections.slice(1).join("\n\n");
  })();

  return (
    <div className="merge-memory-card">
      <span className="merge-memory-card__eyebrow">Merged into Main</span>
      <strong>{`Merged from "${sourceTitle}"`}</strong>
      <p>Added branch learnings to main memory.</p>
      {mergeId ? (
        <button
          className="merge-memory-card__toggle"
          onClick={() => setIsDetailsOpen((current) => !current)}
          type="button"
        >
          {isDetailsOpen ? "Hide details" : "View details"}
        </button>
      ) : null}
      {isDetailsOpen ? (
        <div className="merge-memory-card__details">
          <MarkdownContent className="markdown-content" content={detailContent || "..."} />
        </div>
      ) : null}
    </div>
  );
};

const BranchGraphLoading = () => (
  <section className="branch-graph branch-graph--loading" aria-label="Loading branch graph">
    <div className="branch-graph__canvas">
      <div className="branch-graph__loading-copy">
        Loading the path graph and preparing the live lineage layout...
      </div>
    </div>
  </section>
);

const getSharedConversationTokenFromLocation = () => {
  if (typeof window === "undefined") {
    return null;
  }

  const match = window.location.pathname.match(/^\/shared\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
};

const SharedConversationView = ({
  activePathId,
  error,
  onSelectPath,
  sharedConversation,
  status
}: {
  activePathId: string | null;
  error: string | null;
  onSelectPath: (pathId: string) => void;
  sharedConversation: SharedConversationResponse | null;
  status: string;
}) => {
  const activePath =
    sharedConversation?.paths.find((path) => path.id === activePathId) ??
    sharedConversation?.paths.find((path) => path.isMain) ??
    sharedConversation?.paths[0] ??
    null;
  const activeMessages = activePath
    ? sharedConversation?.messagesByPathId[activePath.id] ?? []
    : [];

  return (
    <main className="shared-page">
      <aside className="shared-page__sidebar">
        <span className="shared-page__eyebrow">Shared read-only chat</span>
        <h1>{sharedConversation?.conversation.title ?? "Shared conversation"}</h1>
        <p>
          {sharedConversation
            ? "This public link lets viewers read the conversation and its branches only."
            : status}
        </p>

        {error ? <div className="error-banner">{error}</div> : null}

        {sharedConversation ? (
          <div className="shared-page__paths">
            {sharedConversation.paths.map((path) => (
              <button
                className={`shared-page__path ${
                  activePath?.id === path.id ? "shared-page__path--active" : ""
                }`}
                key={path.id}
                onClick={() => onSelectPath(path.id)}
                type="button"
              >
                <span>{path.isMain ? "Main" : `Branch depth ${path.depth}`}</span>
                <strong>{path.isMain ? sharedConversation.conversation.title : path.title}</strong>
              </button>
            ))}
          </div>
        ) : null}
      </aside>

      <section className="shared-page__workspace">
        {!sharedConversation ? (
          <div className="hero-empty">
            <span className="hero-empty__badge">Loading</span>
            <h3 className="hero-empty__title">{status}</h3>
          </div>
        ) : activePath ? (
          <>
            <header className="shared-page__header">
              <span>{activePath.isMain ? "Main path" : "Branch"}</span>
              <h2>{activePath.isMain ? sharedConversation.conversation.title : activePath.title}</h2>
            </header>
            <div className="shared-page__messages">
              {activeMessages.length === 0 ? (
                <p className="shared-page__empty">No messages on this path yet.</p>
              ) : (
                activeMessages.map((message) => (
                  <article
                    className={`chat-message chat-message--${message.role}`}
                    key={message.id}
                  >
                    <div className="chat-message__meta">
                      <span className="chat-message__label">
                        {message.role === "assistant"
                          ? "Assistant"
                          : message.role === "user"
                            ? "You"
                            : formatRoleLabel(message.role)}
                      </span>
                    </div>
                    {message.role === "assistant" ? (
                      <div className="assistant-response">
                        <MarkdownContent
                          className="markdown-content markdown-content--message"
                          content={message.contentText || "..."}
                        />
                      </div>
                    ) : (
                      <div className="chat-bubble">
                        <p>{message.contentText || "..."}</p>
                      </div>
                    )}
                  </article>
                ))
              )}
            </div>
          </>
        ) : (
          <p className="shared-page__empty">This shared conversation has no paths.</p>
        )}
      </section>
    </main>
  );
};

const BranchDraftModal = ({
  branchDraft,
  isCreatingBranch,
  isSending,
  onCancel,
  onCreateBranch,
  onUpdateTitle
}: {
  branchDraft: BranchDraft;
  isCreatingBranch: boolean;
  isSending: boolean;
  onCancel: () => void;
  onCreateBranch: () => void;
  onUpdateTitle: (value: string) => void;
}) => (
  <div className="branch-modal" onClick={onCancel} role="presentation">
    <div
      aria-modal="true"
      className="branch-modal__dialog"
      onClick={(event) => event.stopPropagation()}
      role="dialog"
    >
      <div className="branch-modal__header">
        <span className="branch-modal__label">Branch from selection</span>
        <button className="branch-modal__close" onClick={onCancel} type="button">
          Close
        </button>
      </div>

      <p className="branch-modal__focus">{truncateText(branchDraft.focusText, 220)}</p>

      <label className="branch-draft-field branch-draft-field--title">
        <span className="field-label">Branch Title</span>
        <input
          className="text-input text-input--compact"
          onChange={(event) => onUpdateTitle(event.target.value)}
          value={branchDraft.title}
        />
      </label>

      <p className="branch-modal__copy">
        This branch will continue as a regular chat from the selected point.
      </p>

      <div className="branch-modal__actions">
        <button className="secondary-button" onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          className="primary-button primary-button--inline"
          disabled={isCreatingBranch || isSending}
          onClick={onCreateBranch}
          type="button"
        >
          {isCreatingBranch ? "Creating branch..." : "Create Branch"}
        </button>
      </div>
    </div>
  </div>
);

const BranchableMarkdownContent = ({
  branchDraft,
  className,
  content,
  message,
  onOpenBranchDraft
}: {
  branchDraft: BranchDraft | null;
  className?: string;
  content: string;
  message: Message;
  onOpenBranchDraft: (
    message: Message,
    branchTarget: {
      blockEndOffset: number;
      blockStartOffset: number;
      blockType: string;
      focusText: string;
      targetId: string;
    }
  ) => void;
}) => {
  const getBlockOffsets = (
    node: { position?: { end?: { offset?: number }; start?: { offset?: number } } } | undefined
  ) => {
    const start = node?.position?.start?.offset;
    const end = node?.position?.end?.offset;

    if (typeof start !== "number" || typeof end !== "number" || end <= start) {
      return null;
    }

    return {
      end,
      start
    };
  };

  const createBlockId = (
    node: { position?: { end?: { offset?: number }; start?: { offset?: number } } } | undefined,
    tagName: string,
    textContent: string
  ) => {
    const offsets = getBlockOffsets(node);
    const start = offsets?.start ?? 0;
    const end = offsets?.end ?? 0;
    const fallback = normalizeChatText(textContent).slice(0, 32) || tagName;

    return `${message.id}-${tagName}-${start}-${end}-${fallback}`;
  };

  const renderBranchAction = ({
    blockId,
    blockType,
    focusText,
    offsets,
    placement,
    title
  }: {
    blockId: string;
    blockType: string;
    focusText: string;
    offsets: { end: number; start: number } | null;
    placement: "inline" | "surface";
    title: string;
  }) =>
    focusText && offsets ? (
      <button
        className={`branchable-action branchable-action--${placement}`}
        onClick={() =>
          onOpenBranchDraft(message, {
            blockEndOffset: offsets.end,
            blockStartOffset: offsets.start,
            blockType,
            focusText,
            targetId: blockId
          })
        }
        title={title}
        type="button"
      >
        <BranchActionIcon />
      </button>
    ) : null;

  const renderBranchableHeading = (
    tagName: "h1" | "h2" | "h3" | "h4",
    children: ReactNode,
    node: { position?: { end?: { offset?: number }; start?: { offset?: number } } } | undefined
  ) => {
    const focusText = normalizeChatText(extractNodeText(children));
    const offsets = getBlockOffsets(node);
    const blockId = createBlockId(node, tagName, focusText);
    const isActive = branchDraft?.targetId === blockId;
    const action = renderBranchAction({
      blockId,
      blockType: tagName,
      focusText,
      offsets,
      placement: "inline",
      title: "Create branch from this heading"
    });

    return (
      <div className={`branchable-block ${isActive ? "branchable-block--active" : ""}`}>
        {tagName === "h1" ? (
          <h1>
            {children}
            {action}
          </h1>
        ) : tagName === "h2" ? (
          <h2>
            {children}
            {action}
          </h2>
        ) : tagName === "h3" ? (
          <h3>
            {children}
            {action}
          </h3>
        ) : (
          <h4>
            {children}
            {action}
          </h4>
        )}
      </div>
    );
  };

  const renderBranchableBlock = (
    tagName: "blockquote" | "pre" | "table",
    children: ReactNode,
    node: { position?: { end?: { offset?: number }; start?: { offset?: number } } } | undefined
  ) => {
    const focusText = normalizeChatText(extractNodeText(children));
    const offsets = getBlockOffsets(node);
    const blockId = createBlockId(node, tagName, focusText);
    const isActive = branchDraft?.targetId === blockId;

    return (
      <div
        className={`branchable-block branchable-block--surface ${
          isActive ? "branchable-block--active" : ""
        }`}
      >
        {tagName === "blockquote" ? (
          <blockquote>{children}</blockquote>
        ) : tagName === "pre" ? (
          <pre>{children}</pre>
        ) : (
          <table>{children}</table>
        )}

        {renderBranchAction({
          blockId,
          blockType: tagName,
          focusText,
          offsets,
          placement: "surface",
          title: "Create branch from this section"
        })}
      </div>
    );
  };

  const components: Components = {
    blockquote: ({ children, node }) => renderBranchableBlock("blockquote", children, node),
    h1: ({ children, node }) => renderBranchableHeading("h1", children, node),
    h2: ({ children, node }) => renderBranchableHeading("h2", children, node),
    h3: ({ children, node }) => renderBranchableHeading("h3", children, node),
    h4: ({ children, node }) => renderBranchableHeading("h4", children, node),
    li: ({ children, node }) => {
      const focusText = normalizeChatText(extractNodeText(children));
      const offsets = getBlockOffsets(node);
      const blockId = createBlockId(node, "li", focusText);
      const isActive = branchDraft?.targetId === blockId;
      const action = renderBranchAction({
        blockId,
        blockType: "li",
        focusText,
        offsets,
        placement: "inline",
        title: "Create branch from this list item"
      });

      return (
        <li
          className={`branchable-list-item branchable-block ${
            isActive ? "branchable-block--active" : ""
          }`}
        >
          {appendInlineAction(children, action)}
        </li>
      );
    },
    pre: ({ children, node }) => renderBranchableBlock("pre", children, node),
    table: ({ children, node }) => renderBranchableBlock("table", children, node)
  };

  return (
    <div className={className}>
      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
};

export const App = () => {
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollRestoreRef = useRef<{
    conversationId: string;
    pathId: string;
  } | null>(null);
  const viewStateSaveTimeoutRef = useRef<number | null>(null);
  const mobileSidebarSwipeStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const sidebarLongPressRef = useRef<{
    chat: RecentChat;
    pointerId: number;
    timer: number;
    x: number;
    y: number;
  } | null>(null);
  const [conversationTitle, setConversationTitle] = useState("Untitled Chat");
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [paths, setPaths] = useState<ConversationPath[]>([]);
  const [activePath, setActivePath] = useState<PathSummary | null>(null);
  const [activePathId, setActivePathId] = useState<string | null>(null);
  const [provenance, setProvenance] = useState<PathProvenance | null>(null);
  const [snapshot, setSnapshot] = useState<PathSnapshot | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [branchDraft, setBranchDraft] = useState<BranchDraft | null>(null);
  const [conversationMerges, setConversationMerges] = useState<
    Array<{
      merge: MergeRecord;
      artifact: MemoryArtifact | null;
    }>
  >([]);
  const [mergeMode, setMergeMode] = useState<MergeMode>("light");
  const [mergeResult, setMergeResult] = useState<MergeResponse | null>(null);
  const [selectedMergeId, setSelectedMergeId] = useState<string | null>(null);
  const [selectedMergeDetail, setSelectedMergeDetail] = useState<MergeResponse | null>(null);
  const [isLoadingMergeDetail, setIsLoadingMergeDetail] = useState(false);
  const [mergeElapsedSeconds, setMergeElapsedSeconds] = useState(0);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [isCompareLoading, setIsCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareParentMessages, setCompareParentMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("Create a conversation to begin.");
  const [error, setError] = useState<string | null>(null);
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [isGraphOverlayOpen, setIsGraphOverlayOpen] = useState(false);
  const [isGraphDetailsOpen, setIsGraphDetailsOpen] = useState(false);
  const [isOpsOverlayOpen, setIsOpsOverlayOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    const storedValue = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);

    if (storedValue !== null) {
      return storedValue === "true";
    }

    return isPhoneViewport();
  });
  const [adminApiKey, setAdminApiKey] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }

    return window.sessionStorage.getItem(ADMIN_KEY_STORAGE_KEY) ?? "";
  });
  const [opsStatusFilter, setOpsStatusFilter] = useState<
    "all" | "completed" | "failed" | "queued" | "started"
  >("all");
  const [isOpsLoading, setIsOpsLoading] = useState(false);
  const [opsError, setOpsError] = useState<string | null>(null);
  const [opsSummary, setOpsSummary] = useState<ObservabilitySummaryResponse | null>(null);
  const [opsRuns, setOpsRuns] = useState<ModelRunRecord[]>([]);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeConfirmation, setMergeConfirmation] =
    useState<MergeConfirmationResponse | null>(null);
  const [mergeSuccessNotice, setMergeSuccessNotice] = useState<{
    sourcePathTitle: string;
    targetPathId: string;
    targetPathTitle: string;
  } | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [recentChats, setRecentChats] = useState<RecentChat[]>([]);
  const [hasLoadedRecentChats, setHasLoadedRecentChats] = useState(false);
  const [hasAttemptedRecentRestore, setHasAttemptedRecentRestore] = useState(false);
  const [sharedConversationToken] = useState(getSharedConversationTokenFromLocation);
  const [sidebarMenu, setSidebarMenu] = useState<SidebarMenuState | null>(null);
  const [renamingChat, setRenamingChat] = useState<RecentChat | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deletingChat, setDeletingChat] = useState<RecentChat | null>(null);
  const [isSidebarActionLoading, setIsSidebarActionLoading] = useState(false);
  const [sidebarActionStatus, setSidebarActionStatus] = useState<string | null>(null);
  const [sharedConversation, setSharedConversation] = useState<SharedConversationResponse | null>(
    null
  );
  const [activeSharedPathId, setActiveSharedPathId] = useState<string | null>(null);
  const [sharedConversationStatus, setSharedConversationStatus] = useState("Loading shared chat...");
  const [sharedConversationError, setSharedConversationError] = useState<string | null>(null);

  const activePathCatalogItem = useMemo(
    () => paths.find((item) => item.id === activePathId) ?? null,
    [activePathId, paths]
  );

  const pathChildrenById = useMemo(() => {
    const grouped = new Map<string, ConversationPath[]>();

    for (const path of paths) {
      if (!path.parentPathId) {
        continue;
      }

      const current = grouped.get(path.parentPathId) ?? [];
      current.push(path);
      grouped.set(path.parentPathId, current);
    }

    return grouped;
  }, [paths]);

  const visiblePathTree = useMemo(() => {
    const groupedByParent = new Map<string | null, ConversationPath[]>();

    for (const item of paths) {
      const group = groupedByParent.get(item.parentPathId) ?? [];
      group.push(item);
      groupedByParent.set(item.parentPathId, group);
    }

    const sortPaths = (items: ConversationPath[]) =>
      [...items].sort((left, right) => {
        if (left.isMain !== right.isMain) {
          return left.isMain ? -1 : 1;
        }

        return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      });

    const flattened: Array<ConversationPath & { visualDepth: number }> = [];

    const visit = (parentId: string | null, visualDepth: number) => {
      const children = sortPaths(groupedByParent.get(parentId) ?? []);

      for (const child of children) {
        flattened.push({
          ...child,
          visualDepth
        });
        visit(child.id, visualDepth + 1);
      }
    };

    visit(null, 0);

    return flattened;
  }, [paths]);

  const parentPathTitle = useMemo(() => {
    if (provenance?.parentPath?.title) {
      return provenance.parentPath.title;
    }

    if (!activePathCatalogItem?.parentPathId) {
      return null;
    }

    return paths.find((item) => item.id === activePathCatalogItem.parentPathId)?.title ?? null;
  }, [activePathCatalogItem, paths, provenance]);

  const parentPathId = provenance?.parentPath?.id ?? activePath?.parentPathId ?? null;

  const splitSequenceNo = provenance?.splitMessage?.sequenceNo ?? null;

  const parentContinuationMessages = useMemo(() => {
    if (!splitSequenceNo) {
      return compareParentMessages;
    }

    return compareParentMessages.filter((message, index) => index + 1 > splitSequenceNo);
  }, [compareParentMessages, splitSequenceNo]);

  const mergeModeDescription = useMemo(
    () =>
      MERGE_MODE_OPTIONS.find((option) => option.value === mergeMode)?.description ?? null,
    [mergeMode]
  );

  const mergesByPathId = useMemo(() => {
    const mergeMap = new Map<string, Array<{ merge: MergeRecord; artifact: MemoryArtifact | null }>>();

    for (const item of conversationMerges) {
      const current = mergeMap.get(item.merge.sourcePathId) ?? [];
      current.push(item);
      mergeMap.set(item.merge.sourcePathId, current);
    }

    return mergeMap;
  }, [conversationMerges]);

  const activePathMergeHistory = useMemo(() => {
    if (!activePathId) {
      return [];
    }

    if (activePath?.isMain) {
      return conversationMerges.filter((item) => item.merge.targetPathId === activePathId);
    }

    return conversationMerges.filter((item) => item.merge.sourcePathId === activePathId);
  }, [activePath?.isMain, activePathId, conversationMerges]);

  const activePathDetail = useMemo(() => {
    if (!activePathCatalogItem) {
      return null;
    }

    const directChildren = pathChildrenById.get(activePathCatalogItem.id) ?? [];
    const lineage: ConversationPath[] = [];
    let currentParentId = activePathCatalogItem.parentPathId;

    while (currentParentId) {
      const parent = paths.find((path) => path.id === currentParentId) ?? null;

      if (!parent) {
        break;
      }

      lineage.unshift(parent);
      currentParentId = parent.parentPathId;
    }

    const countDescendants = (pathId: string): number => {
      const children = pathChildrenById.get(pathId) ?? [];

      return children.reduce(
        (total, child) => total + 1 + countDescendants(child.id),
        0
      );
    };

    return {
      createdAtLabel: formatDateTime(activePathCatalogItem.createdAt),
      descendantCount: countDescendants(activePathCatalogItem.id),
      directChildren,
      isMain: activePathCatalogItem.isMain,
      lineage,
      mergeCount: activePathMergeHistory.length,
      parent:
        activePathCatalogItem.parentPathId
          ? paths.find((path) => path.id === activePathCatalogItem.parentPathId) ?? null
          : null,
      path: activePathCatalogItem,
      snapshotPreview:
        snapshot?.snapshotText && !activePathCatalogItem.isMain
          ? truncateText(normalizeChatText(snapshot.snapshotText), 420)
          : null,
      splitMessage: provenance?.splitMessage ?? null
    };
  }, [activePathCatalogItem, activePathMergeHistory.length, pathChildrenById, paths, provenance, snapshot?.snapshotText]);

  const selectedMergeSummary = useMemo(() => {
    if (!selectedMergeId) {
      return null;
    }

    return conversationMerges.find((item) => item.merge.id === selectedMergeId) ?? null;
  }, [conversationMerges, selectedMergeId]);

  const canSend = useMemo(
    () => Boolean(activePathId) && Boolean(draft.trim()) && !isSending,
    [activePathId, draft, isSending]
  );

  const persistLocalActivePathFallback = () => {
    if (!conversation?.id || !activePathId) {
      return;
    }

    updateConversationViewState(conversation.id, (current) => ({
      ...current,
      lastActivePathId: activePathId
    }));
  };

  const switchActivePath = (pathId: string) => {
    if (pathId === activePathId) {
      return;
    }

    persistLocalActivePathFallback();
    setActivePathId(pathId);
  };

  const persistServerConversationView = (conversationId: string, pathId: string | null) => {
    if (viewStateSaveTimeoutRef.current) {
      window.clearTimeout(viewStateSaveTimeoutRef.current);
    }

    viewStateSaveTimeoutRef.current = window.setTimeout(() => {
      void updateServerConversationViewState({
        conversationId,
        lastActivePathId: pathId
      }).catch(() => {
        // Local path fallback keeps navigation usable when the view-state API is offline.
      });
    }, VIEW_STATE_SAVE_DEBOUNCE_MS);
  };

  const activeRecentChat = useMemo(
    () =>
      conversation?.id
        ? recentChats.find((chat) => chat.conversationId === conversation.id) ?? null
        : null,
    [conversation?.id, recentChats]
  );

  const mainConversationTitle = useMemo(() => {
    const getRealTitle = (title: string | null | undefined) => {
      const normalized = title?.trim();

      if (!normalized || ["Main Path", "New chat", "Untitled Chat"].includes(normalized)) {
        return null;
      }

      return normalized;
    };

    const recentTitle = getRealTitle(activeRecentChat?.title);

    if (recentTitle) {
      return recentTitle;
    }

    const canonicalMainPathTitle =
      conversation?.mainPathId
        ? paths.find((path) => path.id === conversation.mainPathId)?.title
        : null;
    const pathTitle = getRealTitle(canonicalMainPathTitle);

    if (pathTitle) {
      return pathTitle;
    }

    const storedConversationTitle = getRealTitle(conversation?.title);

    if (storedConversationTitle) {
      return storedConversationTitle;
    }

    return "Main Chat";
  }, [activeRecentChat?.title, conversation?.mainPathId, conversation?.title, paths]);

  const mainPathMessages = useMemo(
    () => (conversation?.mainPathId && activePathId === conversation.mainPathId ? messages : []),
    [activePathId, conversation?.mainPathId, messages]
  );

  const activeConversationTitle = useMemo(() => {
    if (!activePath?.isMain) {
      return activePathCatalogItem?.title ?? activeRecentChat?.title ?? "Hidden branch";
    }

    if (!isPlaceholderChatTitle(conversation?.title)) {
      return conversation?.title ?? "New chat";
    }

    if (!isPlaceholderChatTitle(activeRecentChat?.title)) {
      return activeRecentChat?.title ?? "New chat";
    }

    return "New chat";
  }, [
    activePath?.isMain,
    activePathCatalogItem?.title,
    activeRecentChat?.title,
    conversation?.title
  ]);

  const activeConversationPreview = useMemo(() => {
    if (!activePath?.isMain && snapshot?.snapshotText) {
      return truncateSnapshot(snapshot.snapshotText) ?? status;
    }

    if (mainPathMessages.length > 0) {
      return generateChatPreview(mainPathMessages);
    }

    return activeRecentChat?.preview ?? status;
  }, [activePath?.isMain, activeRecentChat?.preview, mainPathMessages, snapshot?.snapshotText, status]);

  const refreshConversationPaths = async (conversationId: string) => {
    const result = await getConversationPaths(conversationId);

    setConversation(result.conversation);
    setPaths(result.paths);

    return result.paths;
  };

  const refreshSidebarChats = async () => {
    const result = await listConversations();
    setRecentChats(result.conversations);
    setHasLoadedRecentChats(true);
    return result.conversations;
  };

  const refreshConversationMerges = async (conversationId: string) => {
    const result = await getConversationMerges(conversationId);

    startTransition(() => {
      setConversationMerges(result.merges);
    });

    return result.merges;
  };

  const handleCreateConversation = async () => {
    setIsCreatingConversation(true);
    setError(null);
    setStatus("Creating a new chat...");

    try {
      const result = await createConversation(conversationTitle.trim() || "Untitled Chat");
      const mainPathItem: ConversationPath = {
        createdAt: new Date().toISOString(),
        depth: 0,
        id: result.mainPath.id,
        isMain: true,
        parentPathId: null,
        pathType: "chat",
        splitBlockEndOffset: null,
        splitBlockStartOffset: null,
        splitBlockType: null,
        splitFocusText: null,
        splitFromMessageId: null,
        splitMessageCreatedAt: null,
        splitMessagePreview: null,
        splitMessageSequenceNo: null,
        title: result.mainPath.title
      };

      startTransition(() => {
        setConversation(result.conversation);
        setPaths([mainPathItem]);
        setActivePathId(result.mainPath.id);
        setActivePath({
          conversationId: result.conversation.id,
          depth: 0,
          isMain: true,
          parentPathId: null,
          pathId: result.mainPath.id,
          pathTitle: result.mainPath.title,
          splitFromMessageId: null
        });
        setProvenance(null);
        setSnapshot(null);
        setMessages([]);
        setConversationMerges([]);
        setMergeResult(null);
        setMergeConfirmation(null);
        setMergeSuccessNotice(null);
        setSelectedMergeId(null);
        setSelectedMergeDetail(null);
        setMergeMode("light");
        setStatus("New chat ready. Send the first message.");
      });
      if (isPhoneViewport()) {
        setIsSidebarCollapsed(true);
      }
      setRecentChats((current) =>
        upsertRecentChat(current, {
          conversationId: result.conversation.id,
          mainPathId: result.mainPath.id,
          pinnedAt: null,
          preview: "Start the conversation to generate a title.",
          title: "New chat",
          updatedAt: new Date().toISOString()
        })
      );
      void refreshSidebarChats().catch(() => {
        // The optimistic sidebar item keeps the newly created chat visible.
      });
    } catch (createError) {
      const message =
        createError instanceof Error ? createError.message : "Failed to create conversation.";
      setError(message);
      setStatus("Conversation creation failed.");
    } finally {
      setIsCreatingConversation(false);
    }
  };

  const handleSelectRecentChat = async (chat: RecentChat) => {
    if (isCreatingConversation) {
      return;
    }

    persistLocalActivePathFallback();

    if (conversation?.id === chat.conversationId) {
      return;
    }

    setError(null);
    setStatus("Loading chat...");
    setActivePathId(null);
    setActivePath(null);

    try {
      const loadedPaths = await refreshConversationPaths(chat.conversationId);
      await refreshConversationMerges(chat.conversationId);

      const localViewState = getLocalConversationViewState(chat.conversationId);
      let serverViewState: ConversationViewStateResponse | null = null;

      try {
        serverViewState = await getServerConversationViewState(chat.conversationId);
      } catch {
        serverViewState = null;
      }

      const rememberedPathId =
        serverViewState?.lastActivePathId ?? localViewState.lastActivePathId;
      const fallbackMainPathId =
        chat.mainPathId ?? loadedPaths.find((path) => path.isMain)?.id ?? loadedPaths[0]?.id;
      const nextPathId =
        rememberedPathId && loadedPaths.some((path) => path.id === rememberedPathId)
          ? rememberedPathId
          : fallbackMainPathId;

      if (!nextPathId) {
        throw new Error("Chat has no available path.");
      }

      pendingScrollRestoreRef.current = {
        conversationId: chat.conversationId,
        pathId: nextPathId
      };
      setActivePathId(nextPathId);
      if (isPhoneViewport()) {
        setIsSidebarCollapsed(true);
      }
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load chat.";
      setError(message);
      setStatus("Chat loading failed.");
    }
  };

  useEffect(() => {
    if (!sharedConversationToken) {
      return;
    }

    let isCancelled = false;

    const loadSharedConversation = async () => {
      setSharedConversationStatus("Loading shared chat...");
      setSharedConversationError(null);

      try {
        const result = await getSharedConversation(sharedConversationToken);

        if (isCancelled) {
          return;
        }

        startTransition(() => {
          setSharedConversation(result);
          setActiveSharedPathId(result.paths.find((path) => path.isMain)?.id ?? result.paths[0]?.id ?? null);
          setSharedConversationStatus("Shared chat loaded.");
        });
      } catch (sharedError) {
        if (isCancelled) {
          return;
        }

        const message =
          sharedError instanceof Error ? sharedError.message : "Failed to load shared chat.";
        setSharedConversationError(message);
        setSharedConversationStatus("Shared chat failed to load.");
      }
    };

    void loadSharedConversation();

    return () => {
      isCancelled = true;
    };
  }, [sharedConversationToken]);

  useEffect(() => {
    if (sharedConversationToken) {
      return;
    }

    let isCancelled = false;

    const loadSidebarChats = async () => {
      try {
        const result = await listConversations();

        if (isCancelled) {
          return;
        }

        startTransition(() => {
          setRecentChats(result.conversations);
          setHasLoadedRecentChats(true);
        });
      } catch {
        if (isCancelled) {
          return;
        }

        startTransition(() => {
          setRecentChats(readRecentChats());
          setHasLoadedRecentChats(true);
        });
      }
    };

    void loadSidebarChats();

    return () => {
      isCancelled = true;
    };
  }, [sharedConversationToken]);

  useEffect(() => {
    if (!hasLoadedRecentChats || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(RECENT_CHATS_STORAGE_KEY, JSON.stringify(recentChats));
  }, [hasLoadedRecentChats, recentChats]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      String(isSidebarCollapsed)
    );
  }, [isSidebarCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!adminApiKey.trim()) {
      window.sessionStorage.removeItem(ADMIN_KEY_STORAGE_KEY);
      return;
    }

    window.sessionStorage.setItem(ADMIN_KEY_STORAGE_KEY, adminApiKey.trim());
  }, [adminApiKey]);

  useEffect(() => {
    if (!conversation?.id || !activePathId) {
      return;
    }

    pendingScrollRestoreRef.current = {
      conversationId: conversation.id,
      pathId: activePathId
    };

    persistServerConversationView(conversation.id, activePathId);
    updateConversationViewState(conversation.id, (current) => ({
      ...current,
      lastActivePathId: activePathId
    }));
  }, [activePathId, conversation?.id]);

  useEffect(() => {
    const pending = pendingScrollRestoreRef.current;

    if (
      !pending ||
      pending.conversationId !== conversation?.id ||
      pending.pathId !== activePathId ||
      activePath?.pathId !== pending.pathId
    ) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const transcript = transcriptRef.current;

      if (!transcript) {
        return;
      }

      transcript.scrollTop = Math.max(0, transcript.scrollHeight - transcript.clientHeight);
      pendingScrollRestoreRef.current = null;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activePath?.pathId, activePathId, conversation?.id, messages]);

  useEffect(
    () => () => {
      if (viewStateSaveTimeoutRef.current) {
        window.clearTimeout(viewStateSaveTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    const textarea = composerInputRef.current;

    if (!textarea || typeof window === "undefined") {
      return;
    }

    textarea.style.height = "auto";

    const styles = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 22;
    const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
    const maxHeight = lineHeight * 7 + paddingTop + paddingBottom;
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);

    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [draft]);

  useEffect(() => {
    if (
      !hasLoadedRecentChats ||
      hasAttemptedRecentRestore ||
      recentChats.length === 0 ||
      conversation ||
      activePathId
    ) {
      return;
    }

    setHasAttemptedRecentRestore(true);
    void handleSelectRecentChat(recentChats[0]);
  }, [
    activePathId,
    conversation,
    hasAttemptedRecentRestore,
    hasLoadedRecentChats,
    recentChats
  ]);

  useEffect(() => {
    if (!activePathId) {
      return;
    }

    let isCancelled = false;

    const loadMessages = async () => {
      setStatus("Loading path history...");

      try {
        const result = await getPathMessages(activePathId);

        if (isCancelled) {
          return;
        }

        startTransition(() => {
          setMessages(result.messages);
          setActivePath(result.path);
          setProvenance(result.provenance);
          setSnapshot(result.snapshot);
          setStatus(
            result.messages.length > 0
              ? result.path.isMain
                ? "Main path loaded."
                : "Branch loaded."
              : result.path.isMain
                ? "Main path ready. Send the first message."
                : "Branch ready. Continue from the inherited snapshot."
          );
        });
      } catch (loadError) {
        if (isCancelled) {
          return;
        }

        const message =
          loadError instanceof Error ? loadError.message : "Failed to load path history.";
        setError(message);
        setStatus("History loading failed.");
      }
    };

    void loadMessages();

    return () => {
      isCancelled = true;
    };
  }, [activePathId]);

  useEffect(() => {
    if (!conversation?.id) {
      return;
    }

    let isCancelled = false;

    const loadMerges = async () => {
      try {
        const result = await getConversationMerges(conversation.id);

        if (isCancelled) {
          return;
        }

        startTransition(() => {
          setConversationMerges(result.merges);
        });
      } catch {
        if (isCancelled) {
          return;
        }
      }
    };

    void loadMerges();

    return () => {
      isCancelled = true;
    };
  }, [conversation?.id]);

  useEffect(() => {
    const conversationId = conversation?.id;
    const mainPathId = conversation?.mainPathId;

    if (!conversationId || !mainPathId || activePathId !== mainPathId) {
      return;
    }

    setRecentChats((current) => {
      const existingChat = current.find((chat) => chat.conversationId === conversationId);
      const serverTitle = !isPlaceholderChatTitle(conversation.title)
        ? conversation.title
        : null;
      const lastUserMessageAt =
        mainPathMessages.filter((message) => message.role === "user").at(-1)?.createdAt ?? null;
      const shouldPromoteChat =
        !existingChat ||
        (lastUserMessageAt
          ? new Date(lastUserMessageAt).getTime() >
            new Date(existingChat.updatedAt).getTime()
          : false);
      const shouldRefreshTitle = !existingChat || isPlaceholderChatTitle(existingChat.title);
      const nextChat: RecentChat = {
        conversationId,
        mainPathId,
        pinnedAt: existingChat?.pinnedAt ?? null,
        preview:
          shouldPromoteChat || !existingChat
            ? generateChatPreview(mainPathMessages)
            : existingChat.preview,
        title: serverTitle ?? (shouldRefreshTitle ? "New chat" : existingChat.title),
        updatedAt: shouldPromoteChat
          ? lastUserMessageAt ?? new Date().toISOString()
          : existingChat.updatedAt
      };

      if (
        existingChat &&
        existingChat.mainPathId === nextChat.mainPathId &&
        existingChat.preview === nextChat.preview &&
        existingChat.title === nextChat.title &&
        existingChat.updatedAt === nextChat.updatedAt
      ) {
        return current;
      }

      return upsertRecentChat(current, nextChat);
    });
  }, [
    activePathId,
    conversation?.id,
    conversation?.mainPathId,
    conversation?.title,
    mainPathMessages
  ]);

  useEffect(() => {
    setBranchDraft(null);
    setIsGraphOverlayOpen(false);
    setIsGraphDetailsOpen(false);
    setMergeResult(null);
    setMergeConfirmation(null);
    setMergeSuccessNotice(null);
    setSelectedMergeId(null);
    setSelectedMergeDetail(null);
    setIsCompareOpen(false);
    setIsCompareLoading(false);
    setCompareError(null);
    setCompareParentMessages([]);
  }, [activePathId]);

  useEffect(() => {
    if (!isCompareOpen || !parentPathId || activePath?.isMain) {
      return;
    }

    let isCancelled = false;

    const loadParentComparison = async () => {
      setIsCompareLoading(true);
      setCompareError(null);

      try {
        const result = await getPathMessages(parentPathId);

        if (isCancelled) {
          return;
        }

        startTransition(() => {
          setCompareParentMessages(result.messages);
        });
      } catch (compareLoadError) {
        if (isCancelled) {
          return;
        }

        const message =
          compareLoadError instanceof Error
            ? compareLoadError.message
            : "Failed to load parent path comparison.";

        setCompareError(message);
      } finally {
        if (!isCancelled) {
          setIsCompareLoading(false);
        }
      }
    };

    void loadParentComparison();

    return () => {
      isCancelled = true;
    };
  }, [activePath?.isMain, isCompareOpen, parentPathId]);

  useEffect(() => {
    if (!selectedMergeId) {
      return;
    }

    let isCancelled = false;

    const loadMergeDetail = async () => {
      setIsLoadingMergeDetail(true);

      try {
        const result = await getMerge(selectedMergeId);

        if (isCancelled) {
          return;
        }

        startTransition(() => {
          setSelectedMergeDetail(result);
        });
      } catch (mergeDetailError) {
        if (isCancelled) {
          return;
        }

        const message =
          mergeDetailError instanceof Error
            ? mergeDetailError.message
            : "Failed to load merge detail.";

        setError(message);
      } finally {
        if (!isCancelled) {
          setIsLoadingMergeDetail(false);
        }
      }
    };

    void loadMergeDetail();

    return () => {
      isCancelled = true;
    };
  }, [selectedMergeId]);

  useEffect(() => {
    if (selectedMergeId || activePathMergeHistory.length === 0) {
      return;
    }

    setSelectedMergeId(activePathMergeHistory[0]?.merge.id ?? null);
  }, [activePathMergeHistory, selectedMergeId]);

  useEffect(() => {
    if (!isMerging) {
      setMergeElapsedSeconds(0);
      return;
    }

    const interval = window.setInterval(() => {
      setMergeElapsedSeconds((current) => current + 1);
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [isMerging]);

  useEffect(() => {
    if (!isOpsOverlayOpen) {
      return;
    }

    if (!adminApiKey.trim()) {
      setOpsSummary(null);
      setOpsRuns([]);
      setOpsError("Enter your admin key to load observability.");
      return;
    }

    let isCancelled = false;

    const loadObservability = async () => {
      setIsOpsLoading(true);
      setOpsError(null);

      try {
        const [summary, runs] = await Promise.all([
          getObservabilitySummary({
            adminKey: adminApiKey.trim()
          }),
          getObservabilityRuns({
            adminKey: adminApiKey.trim(),
            limit: 60,
            status: opsStatusFilter === "all" ? undefined : opsStatusFilter
          })
        ]);

        if (isCancelled) {
          return;
        }

        startTransition(() => {
          setOpsSummary(summary);
          setOpsRuns(runs.runs);
        });
      } catch (observabilityError) {
        if (isCancelled) {
          return;
        }

        const message =
          observabilityError instanceof Error
            ? observabilityError.message
            : "Failed to load observability.";
        setOpsError(message);
      } finally {
        if (!isCancelled) {
          setIsOpsLoading(false);
        }
      }
    };

    void loadObservability();

    return () => {
      isCancelled = true;
    };
  }, [adminApiKey, isOpsOverlayOpen, opsStatusFilter]);

  const handleSend = async () => {
    if (!activePathId || !draft.trim() || isSending) {
      return;
    }

    const userText = draft.trim();
    const optimisticUserId = createOptimisticId("user");
    const optimisticAssistantId = createOptimisticId("assistant");

    setDraft("");
    setError(null);
    setIsSending(true);
    setStatus(activePath?.isMain ? "Streaming assistant reply..." : "Streaming branch reply...");

    startTransition(() => {
      setMessages((current) => [
        ...current,
        {
          id: optimisticUserId,
          role: "user",
          contentText: userText,
          createdAt: new Date().toISOString(),
          modelName: null
        },
        {
          id: optimisticAssistantId,
          role: "assistant",
          contentText: "",
          createdAt: new Date().toISOString(),
          modelName: OPTIMISTIC_MODEL_NAME
        }
      ]);
    });

    try {
      await streamPathMessage(activePathId, userText, {
        onDelta: (text) => {
          startTransition(() => {
            setMessages((current) =>
              current.map((message) =>
                message.id === optimisticAssistantId
                  ? {
                      ...message,
                      contentText: `${message.contentText}${text}`
                    }
                  : message
              )
            );
          });
        },
        onCompleted: (payload) => {
          startTransition(() => {
            if (payload.conversationTitle) {
              setConversation((current) =>
                current
                  ? {
                      ...current,
                      title: payload.conversationTitle ?? current.title
                    }
                  : current
              );
            }

            setMessages((current) =>
              current.map((message) => {
                if (message.id === optimisticUserId) {
                  return payload.userMessage;
                }

                if (message.id === optimisticAssistantId) {
                  return payload.assistantMessage ?? message;
                }

                return message;
              })
            );
            setActivePath(payload.path);
            setStatus(payload.path.isMain ? "Assistant reply completed." : "Branch reply completed.");
          });
        }
      });
    } catch (sendError) {
      const message =
        sendError instanceof Error ? sendError.message : "Failed to send message.";

      startTransition(() => {
        setMessages((current) =>
          current.filter(
            (item) => item.id !== optimisticUserId && item.id !== optimisticAssistantId
          )
        );
      });

      setError(message);
      setStatus("Message failed.");
    } finally {
      setIsSending(false);
    }
  };

  const handleCreateBranch = async () => {
    if (!branchDraft?.splitFromMessageId) {
      return;
    }

    if (!activePathId || !conversation?.id || isCreatingBranch || isSending) {
      return;
    }

    setIsCreatingBranch(true);
    setError(null);
    setStatus("Creating branch from the selected message...");

    try {
      const result = await createBranch({
        pathId: activePathId,
        pathType: branchDraft.pathType,
        splitBlockEndOffset: branchDraft.splitBlockEndOffset,
        splitBlockStartOffset: branchDraft.splitBlockStartOffset,
        splitBlockType: branchDraft.splitBlockType,
        splitFromMessageId: branchDraft.splitFromMessageId,
        splitFocusText: branchDraft.focusText,
        title: branchDraft.title
      });

      const updatedPaths = await refreshConversationPaths(conversation.id);

      startTransition(() => {
        switchActivePath(result.path.id);
        setBranchDraft(null);
        setProvenance(null);
        setSnapshot(result.snapshot);
        setMessages([]);
        setDraft("");
        setStatus("Branch created. Continue from the inherited snapshot.");
      });

      if (!updatedPaths.some((item) => item.id === result.path.id)) {
        startTransition(() => {
          setPaths((current) => [...current, result.path]);
        });
      }
    } catch (branchError) {
      const message =
        branchError instanceof Error ? branchError.message : "Failed to create branch.";
      setError(message);
      setStatus("Branch creation failed.");
    } finally {
      setIsCreatingBranch(false);
    }
  };

  const handleOpenBranchDraft = (
    message: Message,
    branchTarget: {
      blockEndOffset: number;
      blockStartOffset: number;
      blockType: string;
      focusText: string;
      targetId: string;
    }
  ) => {
    setError(null);
    setBranchDraft((current) => {
      if (current?.targetId === branchTarget.targetId) {
        return null;
      }

      return {
        focusText: branchTarget.focusText,
        splitFromMessageId: message.id,
        splitBlockEndOffset: branchTarget.blockEndOffset,
        splitBlockStartOffset: branchTarget.blockStartOffset,
        splitBlockType: branchTarget.blockType,
        targetId: branchTarget.targetId,
        title: createBranchTitleFromFocus(branchTarget.focusText),
        pathType: "chat"
      };
    });
  };

  const handleToggleCompare = () => {
    setCompareError(null);
    setIsCompareOpen((current) => !current);
  };

  const executeMerge = async (acknowledgeOutdated: boolean) => {
    if (
      !activePathId ||
      !conversation?.mainPathId ||
      activePath?.isMain ||
      isMerging ||
      isSending ||
      isCreatingBranch
    ) {
      return;
    }

    setError(null);
    setMergeSuccessNotice(null);
    setIsMerging(true);
    setStatus(
      acknowledgeOutdated
        ? "Main moved forward. Adapting this branch into the latest main direction..."
        : "Merging branch learning into main memory..."
    );

    try {
      const result = await requestMerge({
        acknowledgeOutdated,
        mergeMode: DEFAULT_MERGE_MODE,
        sourcePathId: activePathId,
        targetPathId: conversation.mainPathId
      });

      await refreshConversationMerges(conversation.id);
      const resolvedTargetPathId =
        result.targetPath?.id ?? conversation.mainPathId ?? activePathId;

      startTransition(() => {
        setMergeConfirmation(null);
        setMergeResult(result);
        setSelectedMergeId(result.merge.id);
        setSelectedMergeDetail(result);
        setMergeSuccessNotice({
          sourcePathTitle: result.sourcePath?.title ?? activePathCatalogItem?.title ?? "Branch",
          targetPathId: resolvedTargetPathId,
          targetPathTitle: mainConversationTitle
        });
        setStatus("Branch merged into main memory.");
      });
    } catch (mergeError) {
      if (mergeError instanceof MergeRequiresConfirmationError) {
        startTransition(() => {
          setMergeConfirmation(mergeError.confirmation);
          setStatus(
            "Main moved forward since this branch split. Confirm merge to adapt into latest main context."
          );
        });

        return;
      }

      const message =
        mergeError instanceof Error ? mergeError.message : "Failed to merge branch into main.";
      setError(message);
      setStatus("Merge failed.");
    } finally {
      setIsMerging(false);
    }
  };

  const handleMerge = () => {
    void executeMerge(false);
  };

  const handleConfirmMerge = () => {
    void executeMerge(true);
  };

  const handleCancelMergeConfirmation = () => {
    setMergeConfirmation(null);
    setStatus("Merge canceled.");
  };

  const handleGoToMainPath = () => {
    if (!conversation?.mainPathId) {
      return;
    }

    switchActivePath(conversation.mainPathId);
    setMergeSuccessNotice(null);
    setMergeConfirmation(null);
    setError(null);
    setStatus("Switched to main chat.");
  };

  const handleMobileSidebarPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!isPhoneViewport() || isSidebarCollapsed || event.pointerType === "mouse") {
      return;
    }

    mobileSidebarSwipeStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY
    };
  };

  const handleMobileSidebarPointerUp = (event: PointerEvent<HTMLElement>) => {
    const start = mobileSidebarSwipeStartRef.current;

    if (!start || start.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    mobileSidebarSwipeStartRef.current = null;

    if (deltaX < -58 && Math.abs(deltaY) < 90) {
      setIsSidebarCollapsed(true);
    }
  };

  const openSidebarMenu = (
    chat: RecentChat,
    anchor: {
      x: number;
      y: number;
    }
  ) => {
    setSidebarActionStatus(null);
    setSidebarMenu({
      chat,
      x: anchor.x,
      y: anchor.y
    });
  };

  const cancelSidebarLongPress = () => {
    const pending = sidebarLongPressRef.current;

    if (pending) {
      window.clearTimeout(pending.timer);
      sidebarLongPressRef.current = null;
    }
  };

  const handleSidebarChatPointerDown = (
    event: PointerEvent<HTMLElement>,
    chat: RecentChat
  ) => {
    if (!isPhoneViewport() || event.pointerType === "mouse") {
      return;
    }

    cancelSidebarLongPress();

    const target = event.currentTarget;
    const timer = window.setTimeout(() => {
      const rect = target.getBoundingClientRect();
      openSidebarMenu(chat, {
        x: Math.min(rect.right - 16, window.innerWidth - 24),
        y: rect.top + rect.height / 2
      });
      sidebarLongPressRef.current = null;
    }, 560);

    sidebarLongPressRef.current = {
      chat,
      pointerId: event.pointerId,
      timer,
      x: event.clientX,
      y: event.clientY
    };
  };

  const handleSidebarChatPointerMove = (event: PointerEvent<HTMLElement>) => {
    const pending = sidebarLongPressRef.current;

    if (!pending || pending.pointerId !== event.pointerId) {
      return;
    }

    if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 10) {
      cancelSidebarLongPress();
    }
  };

  const handleOpenSidebarMenuClick = (
    event: MouseEvent<HTMLButtonElement>,
    chat: RecentChat
  ) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    openSidebarMenu(chat, {
      x: rect.right,
      y: rect.bottom + 6
    });
  };

  const handleShareSidebarChat = async (chat: RecentChat) => {
    setIsSidebarActionLoading(true);
    setSidebarActionStatus(null);

    try {
      const result = await shareConversation(chat.conversationId);
      const shareUrl = result.shareUrl.startsWith("/")
        ? `${window.location.origin}${result.shareUrl}`
        : result.shareUrl;

      await navigator.clipboard.writeText(shareUrl);
      setSidebarActionStatus("Share link copied.");
      setSidebarMenu(null);
    } catch (shareError) {
      const message =
        shareError instanceof Error ? shareError.message : "Failed to create share link.";
      setSidebarActionStatus(message);
    } finally {
      setIsSidebarActionLoading(false);
    }
  };

  const handleOpenRenameChat = (chat: RecentChat) => {
    setRenamingChat(chat);
    setRenameDraft(chat.title);
    setSidebarMenu(null);
    setSidebarActionStatus(null);
  };

  const handleSaveRenameChat = async () => {
    const nextTitle = renameDraft.trim();

    if (!renamingChat || !nextTitle) {
      return;
    }

    setIsSidebarActionLoading(true);
    setSidebarActionStatus(null);

    try {
      const result = await updateConversationRecord({
        conversationId: renamingChat.conversationId,
        title: nextTitle
      });

      setRecentChats((current) =>
        current.map((chat) =>
          chat.conversationId === renamingChat.conversationId
            ? {
                ...chat,
                title: result.conversation.title
              }
            : chat
        )
      );
      setConversation((current) =>
        current?.id === renamingChat.conversationId
          ? {
              ...current,
              title: result.conversation.title
            }
          : current
      );
      setRenamingChat(null);
      setRenameDraft("");
      void refreshSidebarChats().catch(() => {
        // Local renamed row already reflects the change.
      });
    } catch (renameError) {
      const message = renameError instanceof Error ? renameError.message : "Failed to rename chat.";
      setSidebarActionStatus(message);
    } finally {
      setIsSidebarActionLoading(false);
    }
  };

  const handleTogglePinChat = async (chat: RecentChat) => {
    setIsSidebarActionLoading(true);
    setSidebarActionStatus(null);

    try {
      const shouldPin = !chat.pinnedAt;
      const result = await updateConversationRecord({
        conversationId: chat.conversationId,
        pinned: shouldPin
      });

      setSidebarMenu(null);
      setRecentChats((current) =>
        upsertRecentChat(
          current.filter((item) => item.conversationId !== chat.conversationId),
          {
            ...chat,
            pinnedAt: result.conversation.pinnedAt ?? null,
            updatedAt: new Date().toISOString()
          }
        )
      );
      void refreshSidebarChats().catch(() => {
        // Optimistic pin order keeps the menu action responsive.
      });
    } catch (pinError) {
      const message = pinError instanceof Error ? pinError.message : "Failed to update pin.";
      setSidebarActionStatus(message);
    } finally {
      setIsSidebarActionLoading(false);
    }
  };

  const handleConfirmDeleteChat = async () => {
    if (!deletingChat) {
      return;
    }

    setIsSidebarActionLoading(true);
    setSidebarActionStatus(null);

    try {
      await deleteConversationRecord(deletingChat.conversationId);
      const nextChats = await refreshSidebarChats().catch(() =>
        recentChats.filter((chat) => chat.conversationId !== deletingChat.conversationId)
      );
      setRecentChats(nextChats);

      if (conversation?.id === deletingChat.conversationId) {
        const nextChat = nextChats.find(
          (chat) => chat.conversationId !== deletingChat.conversationId
        );

        startTransition(() => {
          setConversation(null);
          setPaths([]);
          setActivePath(null);
          setActivePathId(null);
          setMessages([]);
          setConversationMerges([]);
          setStatus(nextChat ? "Loading next chat..." : "Create a conversation to begin.");
        });

        if (nextChat) {
          void handleSelectRecentChat(nextChat);
        }
      }

      setDeletingChat(null);
    } catch (deleteError) {
      const message =
        deleteError instanceof Error ? deleteError.message : "Failed to delete chat.";
      setSidebarActionStatus(message);
    } finally {
      setIsSidebarActionLoading(false);
    }
  };

  if (sharedConversationToken) {
    return (
      <SharedConversationView
        activePathId={activeSharedPathId}
        error={sharedConversationError}
        onSelectPath={setActiveSharedPathId}
        sharedConversation={sharedConversation}
        status={sharedConversationStatus}
      />
    );
  }

  return (
    <main
      className={`app-shell ${isSidebarCollapsed ? "app-shell--sidebar-collapsed" : ""}`}
    >
      <header className="mobile-navbar">
        <button
          aria-expanded={!isSidebarCollapsed}
          aria-label={isSidebarCollapsed ? "Open chat sidebar" : "Close chat sidebar"}
          className="mobile-navbar__toggle"
          onClick={() => setIsSidebarCollapsed((current) => !current)}
          type="button"
        >
          <SidebarIcon name="collapse" />
        </button>
        <span className="mobile-navbar__title">
          {conversation ? activeConversationTitle : APP_NAME}
        </span>
      </header>

      {!isSidebarCollapsed ? (
        <button
          aria-label="Close chat sidebar"
          className="mobile-sidebar-backdrop"
          onClick={() => setIsSidebarCollapsed(true)}
          type="button"
        />
      ) : null}

      <section
        className="sidebar"
        aria-label="Chat sidebar"
        onPointerCancel={() => {
          mobileSidebarSwipeStartRef.current = null;
        }}
        onPointerDown={handleMobileSidebarPointerDown}
        onPointerUp={handleMobileSidebarPointerUp}
      >
        <div className="sidebar__topbar">
          <button className="sidebar__logo-button" type="button" aria-label={APP_NAME}>
            <SidebarIcon name="brand" />
          </button>
          <button
            aria-expanded={!isSidebarCollapsed}
            className="sidebar__icon-button"
            onClick={() => setIsSidebarCollapsed((current) => !current)}
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            type="button"
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <SidebarIcon name="collapse" />
          </button>
        </div>

        <button
          className="new-chat-button"
          disabled={isCreatingConversation}
          onClick={handleCreateConversation}
          type="button"
        >
          <SidebarIcon name="new" />
          <span>{isCreatingConversation ? "Creating..." : "New chat"}</span>
        </button>

        <button className="sidebar-search-button" type="button">
          <SidebarIcon name="search" />
          <span>Search chats</span>
        </button>

        <div className="sidebar__section">
          <div className="sidebar__section-header">
            <span className="sidebar__section-label">Recents</span>
          </div>

          <div className="chat-list">
            {recentChats.length === 0 ? (
              <p className="sidebar__empty">
                Start a chat and its title will appear here after your opening messages.
              </p>
            ) : (
              recentChats.map((chat) => (
                <div
                  className={`chat-list-item ${conversation?.id === chat.conversationId ? "chat-list-item--active" : ""}`}
                  key={chat.conversationId}
                  onPointerCancel={cancelSidebarLongPress}
                  onPointerDown={(event) => handleSidebarChatPointerDown(event, chat)}
                  onPointerLeave={cancelSidebarLongPress}
                  onPointerMove={handleSidebarChatPointerMove}
                  onPointerUp={cancelSidebarLongPress}
                >
                  <button
                    className="chat-list-button"
                    onClick={() => {
                      if (sidebarMenu?.chat.conversationId === chat.conversationId) {
                        return;
                      }

                      void handleSelectRecentChat(chat);
                    }}
                    type="button"
                  >
                    <span className="chat-list-button__title">{chat.title}</span>
                    {chat.pinnedAt ? <span className="chat-list-button__pin">Pinned</span> : null}
                  </button>
                  <button
                    aria-label={`Open menu for ${chat.title}`}
                    className="chat-list-menu-button"
                    onClick={(event) => handleOpenSidebarMenuClick(event, chat)}
                    type="button"
                  >
                    <span />
                    <span />
                    <span />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="sidebar__footer">
          {ENABLE_ADMIN_UI ? (
            <button
              className="sidebar-ops-button"
              onClick={() => setIsOpsOverlayOpen(true)}
              type="button"
            >
              Open Ops
            </button>
          ) : null}
          {sidebarActionStatus ? (
            <div className="sidebar-action-status">{sidebarActionStatus}</div>
          ) : null}
          {error ? <div className="error-banner">{error}</div> : null}
        </div>
      </section>

      {sidebarMenu ? (
        <div
          className="chat-context-layer"
          onClick={() => setSidebarMenu(null)}
          role="presentation"
        >
          <div
            className="chat-context-menu"
            onClick={(event) => event.stopPropagation()}
            role="menu"
            style={{
              left: Math.min(sidebarMenu.x, window.innerWidth - 252),
              top: Math.min(sidebarMenu.y, window.innerHeight - 260)
            }}
          >
            <button
              disabled={isSidebarActionLoading}
              onClick={() => {
                void handleShareSidebarChat(sidebarMenu.chat);
              }}
              role="menuitem"
              type="button"
            >
              <span className="chat-context-menu__icon">↥</span>
              Share
            </button>
            <button
              disabled={isSidebarActionLoading}
              onClick={() => handleOpenRenameChat(sidebarMenu.chat)}
              role="menuitem"
              type="button"
            >
              <span className="chat-context-menu__icon">✎</span>
              Rename
            </button>
            <button
              disabled={isSidebarActionLoading}
              onClick={() => {
                void handleTogglePinChat(sidebarMenu.chat);
              }}
              role="menuitem"
              type="button"
            >
              <span className="chat-context-menu__icon">⌖</span>
              {sidebarMenu.chat.pinnedAt ? "Unpin chat" : "Pin chat"}
            </button>
            <button
              className="chat-context-menu__danger"
              disabled={isSidebarActionLoading}
              onClick={() => {
                setDeletingChat(sidebarMenu.chat);
                setSidebarMenu(null);
              }}
              role="menuitem"
              type="button"
            >
              <span className="chat-context-menu__icon">⌫</span>
              Delete
            </button>
          </div>
        </div>
      ) : null}

      {renamingChat ? (
        <div
          className="sidebar-modal-layer"
          onClick={() => setRenamingChat(null)}
          role="presentation"
        >
          <div
            aria-modal="true"
            className="sidebar-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <span className="sidebar-modal__eyebrow">Rename chat</span>
            <h2>Give this chat a clearer title</h2>
            <input
              autoFocus
              maxLength={120}
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleSaveRenameChat();
                }

                if (event.key === "Escape") {
                  setRenamingChat(null);
                }
              }}
              value={renameDraft}
            />
            <div className="sidebar-modal__actions">
              <button
                className="secondary-button"
                disabled={isSidebarActionLoading}
                onClick={() => setRenamingChat(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="primary-button primary-button--inline"
                disabled={isSidebarActionLoading || !renameDraft.trim()}
                onClick={() => {
                  void handleSaveRenameChat();
                }}
                type="button"
              >
                {isSidebarActionLoading ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deletingChat ? (
        <div
          className="sidebar-modal-layer"
          onClick={() => setDeletingChat(null)}
          role="presentation"
        >
          <div
            aria-modal="true"
            className="sidebar-modal sidebar-modal--danger"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <span className="sidebar-modal__eyebrow">Delete chat</span>
            <h2>{`Delete "${deletingChat.title}"?`}</h2>
            <p>This permanently deletes the chat, branches, messages, merges, and share links.</p>
            <div className="sidebar-modal__actions">
              <button
                className="secondary-button"
                disabled={isSidebarActionLoading}
                onClick={() => setDeletingChat(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="primary-button primary-button--inline sidebar-modal__delete"
                disabled={isSidebarActionLoading}
                onClick={() => {
                  void handleConfirmDeleteChat();
                }}
                type="button"
              >
                {isSidebarActionLoading ? "Deleting..." : "Delete forever"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="workspace">
        <div className="transcript" ref={transcriptRef}>
          {!conversation ? (
            <div className="hero-empty">
              <span className="hero-empty__badge">Start here</span>
              <h3 className="hero-empty__title">A cleaner AI chat, centered on reading</h3>
              <p className="hero-empty__copy">
                Create a new chat, ask your first question, and the title in the sidebar
                will adapt from your opening messages.
              </p>
              <button
                className="primary-button primary-button--inline"
                disabled={isCreatingConversation}
                onClick={handleCreateConversation}
                type="button"
              >
                {isCreatingConversation ? "Creating..." : "Create new chat"}
              </button>
            </div>
          ) : messages.length === 0 ? (
            <div className="hero-empty">
              <span className="hero-empty__badge">
                {activePath?.isMain === false ? "Hidden branch" : "New chat"}
              </span>
              <h3 className="hero-empty__title">
                {activePath?.isMain === false
                  ? "Continue the branch quietly"
                  : "Say what you need in your own words"}
              </h3>
              <p className="hero-empty__copy">
                {activePath?.isMain === false
                  ? "The chat canvas is active, but the branching interface is temporarily tucked away."
                  : "The interface stays light on chrome so long answers read like a page instead of a dashboard."}
              </p>

              {activePath?.isMain ? (
                <div className="quick-prompts">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      className="quick-prompt-button"
                      key={prompt}
                      onClick={() => setDraft(prompt)}
                      type="button"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            messages.map((message) => (
              <article className={`chat-message chat-message--${message.role}`} key={message.id}>
                <div className="chat-message__meta">
                  <span className="chat-message__label">
                    {message.role === "assistant"
                      ? "Assistant"
                      : message.role === "user"
                        ? "You"
                        : formatRoleLabel(message.role)}
                  </span>
                </div>

                {message.role === "assistant" ? (
                  message.messageType === "merge_memory" ? (
                    <MergeMemoryCard message={message} />
                  ) : (
                  <div className="assistant-response">
                    <BranchableMarkdownContent
                      branchDraft={
                        branchDraft?.splitFromMessageId === message.id ? branchDraft : null
                      }
                      className="markdown-content markdown-content--message"
                      content={message.contentText || "..."}
                      message={message}
                      onOpenBranchDraft={handleOpenBranchDraft}
                    />
                    {message.modelName || message.messageType === "merge_memory" ? (
                      <div className="message-chip-row">
                        {message.messageType === "merge_memory" ? (
                          <span className="message-tag">Merged memory</span>
                        ) : null}
                        {message.modelName ? (
                          <span className="message-tag message-tag--muted">
                            {message.modelName}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  )
                ) : (
                  <div className="chat-bubble">
                    <p>{message.contentText || "..."}</p>
                  </div>
                )}
              </article>
            ))
          )}
        </div>

        <div className="composer-shell">
          {activePath?.isMain === false && mergeConfirmation ? (
            <div className="composer-merge-state composer-merge-state--warning">
              <p>
                Main has moved forward since this branch was created. We&apos;ll adapt this
                branch to Main&apos;s latest direction.
              </p>
              <div className="composer-merge-state__actions">
                <button
                  className="secondary-button"
                  disabled={isMerging}
                  onClick={handleCancelMergeConfirmation}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="primary-button primary-button--inline"
                  disabled={isMerging}
                  onClick={handleConfirmMerge}
                  type="button"
                >
                  {isMerging ? "Merging..." : "Merge into Main"}
                </button>
              </div>
            </div>
          ) : null}

          {activePath?.isMain === false && !mergeConfirmation && mergeSuccessNotice ? (
            <div className="composer-merge-state composer-merge-state--success">
              <p>{`Merged from "${mergeSuccessNotice.sourcePathTitle}" into Main.`}</p>
              <div className="composer-merge-state__actions">
                <button
                  className="primary-button primary-button--inline"
                  onClick={handleGoToMainPath}
                  type="button"
                >
                  {`Go to "${mergeSuccessNotice.targetPathTitle}"`}
                </button>
              </div>
            </div>
          ) : null}

          <div className="composer-row">
            <div className="composer">
              <textarea
                className="composer-input"
                disabled={!conversation || isSending}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={!conversation ? "Create a new chat to begin..." : "Ask anything..."}
                ref={composerInputRef}
                rows={1}
                value={draft}
              />
              <button
                className="composer-send"
                disabled={!canSend}
                onClick={handleSend}
                type="button"
                aria-label={isSending ? "Streaming response" : "Send message"}
              >
                {isSending ? <span className="composer-send__loading" /> : <SendIcon />}
              </button>
            </div>

            <div className="composer-actions">
              <button
                className="composer-graph-button"
                disabled={!conversation || paths.length === 0}
                onClick={() => setIsGraphOverlayOpen(true)}
                type="button"
              >
                Graph
              </button>

              {activePath?.isMain === false ? (
                <button
                  className="composer-merge-button"
                  disabled={
                    !conversation ||
                    !activePathId ||
                    !conversation.mainPathId ||
                    isMerging ||
                    isSending ||
                    isCreatingBranch ||
                    Boolean(mergeConfirmation)
                  }
                  onClick={handleMerge}
                  type="button"
                >
                  {isMerging ? "Merging..." : "Merge to Main"}
                </button>
              ) : null}
            </div>
          </div>

          <p className="composer-note">
            {activePath?.isMain === false
              ? "Branch messages stay local to this path until you merge them into Main."
              : "Assistant replies stay open and readable, while only your messages sit in bubbles."}
          </p>
        </div>

        {ENABLE_ADMIN_UI && isOpsOverlayOpen ? (
          <div
            className="ops-overlay"
            onClick={() => setIsOpsOverlayOpen(false)}
            role="presentation"
          >
            <div
              aria-modal="true"
              className="ops-overlay__card"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
            >
              <div className="ops-overlay__header">
                <div className="ops-overlay__heading">
                  <span className="ops-overlay__label">Observability</span>
                  <h2>Runtime & Cost Dashboard</h2>
                  <p>Live model runs, cache usage, latency, and estimated cost from the API.</p>
                </div>
                <button
                  className="ops-overlay__close"
                  onClick={() => setIsOpsOverlayOpen(false)}
                  type="button"
                >
                  Close
                </button>
              </div>

              <div className="ops-overlay__controls">
                <label className="ops-control-field">
                  <span>Admin key</span>
                  <input
                    onChange={(event) => setAdminApiKey(event.target.value)}
                    placeholder="Enter X-Admin-Key"
                    type="password"
                    value={adminApiKey}
                  />
                </label>

                <label className="ops-control-field">
                  <span>Run status</span>
                  <select
                    onChange={(event) =>
                      setOpsStatusFilter(
                        event.target.value as
                          | "all"
                          | "completed"
                          | "failed"
                          | "queued"
                          | "started"
                      )
                    }
                    value={opsStatusFilter}
                  >
                    <option value="all">All</option>
                    <option value="completed">Completed</option>
                    <option value="failed">Failed</option>
                    <option value="queued">Queued</option>
                    <option value="started">Started</option>
                  </select>
                </label>

                <button
                  className="ops-overlay__refresh"
                  disabled={isOpsLoading || !adminApiKey.trim()}
                  onClick={() => {
                    setOpsError(null);
                    setIsOpsLoading(true);
                    Promise.all([
                      getObservabilitySummary({
                        adminKey: adminApiKey.trim()
                      }),
                      getObservabilityRuns({
                        adminKey: adminApiKey.trim(),
                        limit: 60,
                        status: opsStatusFilter === "all" ? undefined : opsStatusFilter
                      })
                    ])
                      .then(([summary, runs]) => {
                        startTransition(() => {
                          setOpsSummary(summary);
                          setOpsRuns(runs.runs);
                        });
                      })
                      .catch((refreshError) => {
                        const message =
                          refreshError instanceof Error
                            ? refreshError.message
                            : "Failed to refresh observability.";
                        setOpsError(message);
                      })
                      .finally(() => {
                        setIsOpsLoading(false);
                      });
                  }}
                  type="button"
                >
                  {isOpsLoading ? "Loading..." : "Refresh"}
                </button>
              </div>

              {opsError ? <div className="ops-overlay__error">{opsError}</div> : null}

              {opsSummary ? (
                <div className="ops-summary-grid">
                  <article className="ops-summary-card">
                    <span>Total runs</span>
                    <strong>{opsSummary.runs.total.toLocaleString()}</strong>
                    <small>{`${opsSummary.runs.completed} completed / ${opsSummary.runs.failed} failed`}</small>
                  </article>
                  <article className="ops-summary-card">
                    <span>Estimated cost</span>
                    <strong>{`$${opsSummary.cost.estimatedUsd.toFixed(6)}`}</strong>
                    <small>Server-side estimate</small>
                  </article>
                  <article className="ops-summary-card">
                    <span>Token usage</span>
                    <strong>{`${opsSummary.tokens.inputTokens.toLocaleString()} in / ${opsSummary.tokens.outputTokens.toLocaleString()} out`}</strong>
                    <small>{`${opsSummary.tokens.cachedTokens.toLocaleString()} cached`}</small>
                  </article>
                  <article className="ops-summary-card">
                    <span>Latency + cache</span>
                    <strong>{`P50 ${opsSummary.latency.p50Ms}ms · P95 ${opsSummary.latency.p95Ms}ms`}</strong>
                    <small>{`${opsSummary.cache.hitRate}% explicit cache`}</small>
                  </article>
                </div>
              ) : null}

              <div className="ops-runs">
                <div className="ops-runs__header">
                  <span>Recent model runs</span>
                  <span>{opsRuns.length}</span>
                </div>
                <div className="ops-runs__table">
                  {opsRuns.length === 0 ? (
                    <p className="ops-runs__empty">
                      {isOpsLoading
                        ? "Loading runs..."
                        : "No model run data for this filter yet."}
                    </p>
                  ) : (
                    opsRuns.map((run) => (
                      <article className="ops-run-row" key={run.id}>
                        <div>
                          <strong>{run.runType}</strong>
                          <span>{run.status}</span>
                        </div>
                        <div>
                          <strong>{run.modelProvider}</strong>
                          <span>{run.modelName}</span>
                        </div>
                        <div>
                          <strong>{run.cacheMode}</strong>
                          <span>{`${run.cachedTokens ?? 0} cached`}</span>
                        </div>
                        <div>
                          <strong>{`${run.inputTokens ?? 0}/${run.outputTokens ?? 0}`}</strong>
                          <span>in/out tokens</span>
                        </div>
                        <div>
                          <strong>{run.latencyMs ? `${run.latencyMs}ms` : "-"}</strong>
                          <span>{new Date(run.createdAt).toLocaleString()}</span>
                        </div>
                        <div>
                          <strong>{`$${Number(run.estimatedCostUsd ?? 0).toFixed(6)}`}</strong>
                          <span>{run.errorText ? truncateText(run.errorText, 48) : "ok"}</span>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {isGraphOverlayOpen && conversation && paths.length > 0 ? (
          <div
            className="graph-overlay"
            onClick={() => setIsGraphOverlayOpen(false)}
            role="presentation"
          >
            <div
              aria-modal="true"
              className="graph-overlay__card"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
            >
              <div className="graph-overlay__header">
                <div className="graph-overlay__heading">
                  <span className="graph-overlay__label">Path graph</span>
                  <h2>Conversation lineage</h2>
                  <p>
                    Open the live graph as an overlay, inspect path structure, and jump
                    between branches without embedding the graph in the chat transcript.
                  </p>
                </div>

                <button
                  className="graph-overlay__close"
                  onClick={() => setIsGraphOverlayOpen(false)}
                  type="button"
                >
                  Close
                </button>
              </div>

              <div className="graph-overlay__body">
                <Suspense fallback={<BranchGraphLoading />}>
                  <BranchGraph
                    activePathId={activePathId}
                    mainTitle={mainConversationTitle}
                    onSelectPath={(pathId) => {
                      switchActivePath(pathId);
                      setError(null);
                      setIsGraphDetailsOpen(false);
                      setIsGraphOverlayOpen(false);
                    }}
                    paths={paths}
                  />
                </Suspense>
              </div>
            </div>
          </div>
        ) : null}

        {branchDraft ? (
          <BranchDraftModal
            branchDraft={branchDraft}
            isCreatingBranch={isCreatingBranch}
            isSending={isSending}
            onCancel={() => setBranchDraft(null)}
            onCreateBranch={handleCreateBranch}
            onUpdateTitle={(value) =>
              setBranchDraft((current) =>
                current
                  ? {
                      ...current,
                      title: value
                    }
                  : current
              )
            }
          />
        ) : null}

        {isGraphDetailsOpen && activePathDetail ? (
          <div
            className="branch-graph__modal"
            onClick={() => setIsGraphDetailsOpen(false)}
            role="presentation"
          >
            <div
              aria-modal="true"
              className="branch-graph__modal-card"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
            >
              <div className="branch-graph__modal-header">
                <span className="branch-graph__modal-label">Path details</span>
                <button
                  className="branch-graph__modal-close"
                  onClick={() => setIsGraphDetailsOpen(false)}
                  type="button"
                >
                  Close
                </button>
              </div>
              <h3>{activePathDetail.path.title}</h3>
              <p>
                {activePathDetail.isMain
                  ? "Canonical main path in the conversation tree."
                  : `${formatPathTypeLabel(activePathDetail.path.pathType)} branch at depth ${activePathDetail.path.depth}.`}
              </p>
              <div className="branch-graph__active-tags">
                <span>{activePathDetail.isMain ? "MAIN" : "BRANCH"}</span>
                <span>ACTIVE</span>
                <span>{`DEPTH ${activePathDetail.path.depth}`}</span>
                <span>{`${activePathDetail.directChildren.length} CHILDREN`}</span>
              </div>

              <div className="branch-graph__detail-grid">
                <div className="branch-graph__detail-item">
                  <span className="branch-graph__detail-label">Type</span>
                  <strong>{activePathDetail.isMain ? "Main path" : formatPathTypeLabel(activePathDetail.path.pathType)}</strong>
                </div>
                <div className="branch-graph__detail-item">
                  <span className="branch-graph__detail-label">Created</span>
                  <strong>{activePathDetail.createdAtLabel}</strong>
                </div>
                <div className="branch-graph__detail-item">
                  <span className="branch-graph__detail-label">Parent</span>
                  <strong>{activePathDetail.parent?.title ?? "Root path"}</strong>
                </div>
                <div className="branch-graph__detail-item">
                  <span className="branch-graph__detail-label">Descendants</span>
                  <strong>{activePathDetail.descendantCount}</strong>
                </div>
                <div className="branch-graph__detail-item">
                  <span className="branch-graph__detail-label">Merges</span>
                  <strong>{activePathDetail.mergeCount}</strong>
                </div>
                <div className="branch-graph__detail-item">
                  <span className="branch-graph__detail-label">Path Id</span>
                  <strong>{truncateText(activePathDetail.path.id, 18)}</strong>
                </div>
              </div>

              {activePathDetail.lineage.length > 0 ? (
                <div className="branch-graph__detail-section">
                  <span className="branch-graph__detail-kicker">Lineage</span>
                  <p className="branch-graph__detail-copy">
                    {activePathDetail.lineage.map((path) => path.title).join(" / ")}
                  </p>
                </div>
              ) : null}

              {activePathDetail.splitMessage ? (
                <div className="branch-graph__detail-section">
                  <span className="branch-graph__detail-kicker">Split point</span>
                  <p className="branch-graph__detail-copy">
                    Forked from {formatRoleLabel(activePathDetail.splitMessage.role)} message #{activePathDetail.splitMessage.sequenceNo}.
                    {activePathDetail.splitMessage.splitBlockType
                      ? ` Split at ${activePathDetail.splitMessage.splitBlockType}.`
                      : ""}
                  </p>
                  <p className="branch-graph__detail-quote">
                    {activePathDetail.splitMessage.splitFocusText ??
                      activePathDetail.splitMessage.contentPreview}
                  </p>
                </div>
              ) : null}

              {activePathDetail.snapshotPreview ? (
                <div className="branch-graph__detail-section">
                  <span className="branch-graph__detail-kicker">Inherited snapshot</span>
                  <p className="branch-graph__detail-copy">{activePathDetail.snapshotPreview}</p>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
};
