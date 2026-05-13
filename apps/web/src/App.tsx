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
  type ChangeEvent,
  type ClipboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  FileText,
  GitMerge,
  Globe2,
  Image as ImageIcon,
  Network,
  Paperclip,
  Pencil,
  PencilLine,
  Pin,
  PinOff,
  Plus,
  RefreshCcw,
  Share2,
  Trash2,
  X
} from "lucide-react";
import remarkGfm from "remark-gfm";

import { APP_NAME, type SourceReference } from "@node-based-chat/shared";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";

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
  modelProvider?: string | null;
  status?: string;
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

type ContextPreviewResponse = {
  context: Record<string, unknown>;
  memories: {
    compaction: MemoryArtifact | null;
    mergeMemories: MemoryArtifact[];
    snapshot: PathSnapshot | null;
  };
  recentMessages: Message[];
  retrievalCandidates: Array<Record<string, unknown>>;
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

type MessageUpdateResponse = {
  message: Message;
  path: PathSummary;
};

type StartedStreamPayload = {
  modelName: string;
  modelProvider: string;
  runId?: string | null;
  pathId: string;
  userMessageId: string;
};

type ApiErrorShape = {
  code?: string;
  message?: string;
  retryable?: boolean;
  type?: string;
};

type ErrorSeverity = "error" | "warning";

type UserFacingError = {
  details: unknown;
  id: string;
  message: string;
  persistent: boolean;
  severity: ErrorSeverity;
  title: string;
};

type FailedStreamPayload = {
  assistantMessage?: Message | null;
  error?: string | ApiErrorShape;
  message?: string;
  path?: PathSummary;
  runId?: string | null;
  userMessage?: Message;
};

type StreamMessageHandlers = {
  onCompleted: (payload: CompletedStreamPayload) => void;
  onDelta: (text: string) => void;
  onStarted?: (payload: StartedStreamPayload) => void;
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

type ModelRunDetailResponse = {
  contextBundle: unknown;
  requestPayload: unknown;
  responsePayload: unknown;
  run: ModelRunRecord & {
    conversationId: string;
    pathId: string;
    messageId: string | null;
    mergeId: string | null;
    requestPayloadJson?: unknown;
    responsePayloadJson?: unknown;
  };
};

type LocalModelOption = {
  family: string;
  id: string;
  label: string;
  modifiedAt: string | null;
  name: string;
  parameterSize: string | null;
  quantizationLevel: string | null;
  size: number | null;
  supportsThinking?: boolean;
};

type LocalModelsResponse = {
  defaultModel: string | null;
  enabled: boolean;
  models: LocalModelOption[];
  provider: string;
  selectedModel: string | null;
  supportsThinking: boolean;
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

type SearchResult = {
  conversationId: string;
  createdAt: string;
  pathId: string | null;
  rank: number;
  snippet: string;
  sourceId: string;
  sourceType:
    | "attachment"
    | "conversation"
    | "memory_artifact"
    | "message"
    | "path"
    | "path_snapshot";
  title: string;
};

type SearchResponse = {
  query: string;
  results: SearchResult[];
};

type CitationPreview = {
  messageId: string;
  source: SourceReference;
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

type SidebarChatAction = {
  icon: ReactNode;
  key: string;
  label: string;
  onSelect: () => void;
  variant?: "default" | "destructive";
};

type ConversationViewState = {
  lastActivePathId?: string;
};

type ConversationViewStateMap = Record<string, ConversationViewState>;

type DraftByPathId = Record<string, string>;

type ComposerAttachment = {
  contentText: string | null;
  dataUrl?: string;
  id: string;
  kind: "file" | "image";
  mimeType: string;
  name: string;
  size: number;
  source: "clipboard" | "file";
  sourceUrl?: string;
  textTruncated?: boolean;
  thumbnailUrl?: string;
  uploadData?: string;
};

type ComposerAttachmentsByPathId = Record<string, ComposerAttachment[]>;

type MessageAttachment = {
  dataUrl?: string;
  id: string;
  kind: "file" | "image";
  mimeType: string;
  name: string;
  size: number;
  sourceUrl?: string;
  source?: "clipboard" | "file";
  thumbnailUrl?: string;
};

type ImagePreview = {
  meta: string;
  name: string;
  src: string;
};

type MessageCacheByPathId = Record<string, Message[]>;

const MERGE_REQUEST_TIMEOUT_MS = 90000;
const VIEW_STATE_SAVE_DEBOUNCE_MS = 250;
const RECENT_CHATS_STORAGE_KEY = "node-based-chat.recent-chats";
const CONVERSATION_VIEW_STATE_STORAGE_KEY = "node-based-chat.conversation-view-state";
const ADMIN_KEY_STORAGE_KEY = "node-based-chat.admin-key";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "node-based-chat.sidebar-collapsed";
const LOCAL_MODEL_STORAGE_KEY = "node-based-chat.local-ollama-model";
const MODEL_THINKING_STORAGE_KEY = "node-based-chat.model-thinking-enabled";
const ANONYMOUS_USER_ID_STORAGE_KEY = "node-based-chat.anonymous-user-id";
const ANONYMOUS_USER_ID_HEADER = "X-Anonymous-User-Id";
const DEFAULT_MERGE_MODE: MergeMode = "collapse";
const LARGE_PASTE_ATTACHMENT_THRESHOLD = 2000;
const MAX_ATTACHMENT_TEXT_CHARS = 45000;
const MAX_COMPOSED_PROMPT_CHARS = 58000;
const MAX_IMAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() ||
  (import.meta.env.PROD ? "" : "http://127.0.0.1:4000");
const ENABLE_ADMIN_UI =
  import.meta.env.VITE_ENABLE_ADMIN_UI?.trim().toLowerCase() === "true";

const isPhoneViewport = () =>
  typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches;

const createPathSummaryFromCatalogItem = (
  path: ConversationPath,
  conversationId: string
): PathSummary => ({
  conversationId,
  depth: path.depth,
  isMain: path.isMain,
  parentPathId: path.parentPathId,
  pathId: path.id,
  pathTitle: path.title,
  splitFromMessageId: path.splitFromMessageId
});

const SIDEBAR_CONTEXT_MENU_WIDTH = 196;
const SIDEBAR_CONTEXT_MENU_HEIGHT = 184;
const SIDEBAR_CONTEXT_MENU_GUTTER = 12;

const clampValue = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const getSidebarMenuAnchor = (rect: DOMRect) => {
  if (typeof window === "undefined") {
    return {
      x: rect.right,
      y: rect.top
    };
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxX = viewportWidth - SIDEBAR_CONTEXT_MENU_WIDTH - SIDEBAR_CONTEXT_MENU_GUTTER;
  const maxY = viewportHeight - SIDEBAR_CONTEXT_MENU_HEIGHT - SIDEBAR_CONTEXT_MENU_GUTTER;
  const opensBesideRow =
    rect.right + SIDEBAR_CONTEXT_MENU_GUTTER + SIDEBAR_CONTEXT_MENU_WIDTH <= viewportWidth;

  return {
    x: clampValue(
      opensBesideRow
        ? rect.right + SIDEBAR_CONTEXT_MENU_GUTTER
        : rect.right - SIDEBAR_CONTEXT_MENU_WIDTH,
      SIDEBAR_CONTEXT_MENU_GUTTER,
      Math.max(SIDEBAR_CONTEXT_MENU_GUTTER, maxX)
    ),
    y: clampValue(rect.top, SIDEBAR_CONTEXT_MENU_GUTTER, Math.max(SIDEBAR_CONTEXT_MENU_GUTTER, maxY))
  };
};

const createAnonymousUserId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return [
    Math.random().toString(16).slice(2, 10).padEnd(8, "0"),
    Math.random().toString(16).slice(2, 6).padEnd(4, "0"),
    `4${Math.random().toString(16).slice(2, 5).padEnd(3, "0")}`,
    `8${Math.random().toString(16).slice(2, 5).padEnd(3, "0")}`,
    Math.random().toString(16).slice(2, 14).padEnd(12, "0")
  ].join("-");
};

const getAnonymousUserId = () => {
  if (typeof window === "undefined") {
    return null;
  }

  const storedUserId = window.localStorage.getItem(ANONYMOUS_USER_ID_STORAGE_KEY);

  if (storedUserId) {
    return storedUserId;
  }

  const nextUserId = createAnonymousUserId();
  window.localStorage.setItem(ANONYMOUS_USER_ID_STORAGE_KEY, nextUserId);

  return nextUserId;
};

const withAnonymousUserHeaders = (headers?: HeadersInit) => {
  const nextHeaders = new Headers(headers);
  const anonymousUserId = getAnonymousUserId();

  if (anonymousUserId) {
    nextHeaders.set(ANONYMOUS_USER_ID_HEADER, anonymousUserId);
  }

  return nextHeaders;
};

const apiFetch = (input: RequestInfo | URL, init: RequestInit = {}) =>
  fetch(input, {
    ...init,
    headers: withAnonymousUserHeaders(init.headers)
  });

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

const BonsaiLogo = () => (
  <svg
    aria-hidden="true"
    className="app-logo-mark"
    focusable="false"
    viewBox="0 0 512 512"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect width="512" height="512" rx="112" fill="#F7F1EA" />
    <text
      x="256"
      y="286"
      textAnchor="middle"
      dominantBaseline="middle"
      fontSize="340"
      fontFamily="serif"
      fontWeight="600"
      fill="#8B5E4E"
    >
      木
    </text>
  </svg>
);

const SidebarIcon = ({
  name
}: {
  name: "brand" | "collapse" | "new" | "search";
}) => {
  if (name === "brand") {
    return <BonsaiLogo />;
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

const SidebarCollapseButton = ({
  className,
  collapsedLabel = "Expand sidebar",
  expandedLabel = "Collapse sidebar"
}: {
  className: string;
  collapsedLabel?: string;
  expandedLabel?: string;
}) => {
  const { open, toggleSidebar } = useSidebar();
  const label = open ? expandedLabel : collapsedLabel;

  return (
    <Button
      aria-expanded={open}
      aria-label={label}
      className={className}
      onClick={toggleSidebar}
      title={label}
      type="button"
    >
      <SidebarIcon name="collapse" />
    </Button>
  );
};

const SendIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <path d="M12 19V5" />
    <path d="m6.5 10.5 5.5-5.5 5.5 5.5" />
  </svg>
);

const StopGeneratingIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <rect x="8" y="8" width="8" height="8" rx="1.25" />
  </svg>
);

const BranchActionIcon = () => (
  <svg aria-hidden="true" className="branch-action-icon size-3" viewBox="3 2 18 19">
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
    const payload = (await response.json()) as {
      error?: string | ApiErrorShape;
      message?: string;
    };

    if (payload.error && typeof payload.error === "object") {
      return payload.error.message ?? payload.message ?? "Request failed.";
    }

    return normalizeUserFacingError(payload).message;
  }

  const text = await response.text();
  return normalizeUserFacingError(text || "Request failed.").message;
};

const isErrorLikeRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const tryParseJson = (value: string): unknown | null => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

const parseSseErrorPayload = (value: string) => {
  if (!value.includes("event:") || !value.includes("data:")) {
    return null;
  }

  const dataLines = value
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("data:"))
    .map((line) => line.replace(/^\s*data:\s?/u, ""));

  if (dataLines.length === 0) {
    const inlineData = value.match(/data:\s*(\{[\s\S]*\})/u);

    return inlineData?.[1] ? tryParseJson(inlineData[1]) : null;
  }

  return tryParseJson(dataLines.join("\n"));
};

const unwrapErrorPayload = (value: unknown): unknown => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const ssePayload = parseSseErrorPayload(trimmed);

    if (ssePayload) {
      return unwrapErrorPayload(ssePayload);
    }

    const parsed = tryParseJson(trimmed);

    return parsed ? unwrapErrorPayload(parsed) : trimmed;
  }

  if (!isErrorLikeRecord(value)) {
    return value;
  }

  const error = value.error;

  if (typeof error === "string") {
    const parsedError = tryParseJson(error.trim());

    return parsedError
      ? unwrapErrorPayload(parsedError)
      : {
          ...value,
          error
        };
  }

  if (isErrorLikeRecord(error) && typeof error.message === "string") {
    const parsedMessage = tryParseJson(error.message.trim());

    if (parsedMessage) {
      return unwrapErrorPayload({
        ...value,
        error: {
          ...error,
          message: unwrapErrorPayload(parsedMessage)
        }
      });
    }
  }

  return value;
};

const getNestedErrorMessage = (value: unknown): string | null => {
  const unwrapped = unwrapErrorPayload(value);

  if (typeof unwrapped === "string") {
    return unwrapped;
  }

  if (!isErrorLikeRecord(unwrapped)) {
    return null;
  }

  const error = unwrapped.error;

  if (typeof error === "string") {
    return error;
  }

  if (isErrorLikeRecord(error)) {
    const errorMessage = getNestedErrorMessage(error.message);

    if (errorMessage) {
      return errorMessage;
    }
  }

  if (typeof unwrapped.message === "string") {
    return unwrapped.message;
  }

  return null;
};

const getNestedErrorCode = (value: unknown): string | null => {
  const unwrapped = unwrapErrorPayload(value);

  if (!isErrorLikeRecord(unwrapped)) {
    return null;
  }

  const error = unwrapped.error;

  if (isErrorLikeRecord(error) && typeof error.code === "string") {
    return error.code;
  }

  return typeof unwrapped.code === "string" ? unwrapped.code : null;
};

const getNestedErrorType = (value: unknown): string | null => {
  const unwrapped = unwrapErrorPayload(value);

  if (!isErrorLikeRecord(unwrapped)) {
    return null;
  }

  const error = unwrapped.error;

  if (isErrorLikeRecord(error) && typeof error.type === "string") {
    return error.type;
  }

  return typeof unwrapped.type === "string" ? unwrapped.type : null;
};

const normalizeErrorDetails = (value: unknown): unknown => {
  if (value instanceof Error) {
    const record = value as Error & {
      payload?: unknown;
    };

    return record.payload ?? {
      message: value.message,
      name: value.name
    };
  }

  return value;
};

const makeUserFacingError = ({
  details,
  message,
  persistent = true,
  severity = "error",
  title
}: {
  details: unknown;
  message: string;
  persistent?: boolean;
  severity?: ErrorSeverity;
  title: string;
}): UserFacingError => ({
  details,
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  message,
  persistent,
  severity,
  title
});

const normalizeUserFacingError = (value: unknown): UserFacingError => {
  const details = normalizeErrorDetails(value);
  const message =
    getNestedErrorMessage(details) ??
    (value instanceof Error ? value.message : null) ??
    "Something went wrong.";
  const code = getNestedErrorCode(details);
  const type = getNestedErrorType(details);
  const loweredMessage = message.toLowerCase();

  if (
    code === "AI_PROVIDER_CAPABILITY_UNSUPPORTED" ||
    loweredMessage.includes("web search requires")
  ) {
    return makeUserFacingError({
      details,
      message: "Web search works only with hosted Gemini. It is hidden in local Ollama mode.",
      persistent: false,
      severity: "warning",
      title: "Web search unavailable"
    });
  }

  if (
    loweredMessage.includes("could not reach ollama") ||
    loweredMessage.includes("start ollama") ||
    loweredMessage.includes("econnrefused")
  ) {
    return makeUserFacingError({
      details,
      message: "Open the Ollama app, make sure it is running, then try again.",
      title: "Ollama is not running"
    });
  }

  if (
    loweredMessage.includes("no local gemma 4") ||
    loweredMessage.includes("not an installed gemma 4") ||
    loweredMessage.includes("selected local model")
  ) {
    return makeUserFacingError({
      details,
      message: "Install the selected Gemma 4 model in Ollama, then try again.",
      title: "Gemma 4 model missing"
    });
  }

  if (code === "VALIDATION_ERROR" || type === "validation") {
    return makeUserFacingError({
      details,
      message,
      persistent: false,
      severity: "warning",
      title: "Request needs a small fix"
    });
  }

  if (type === "provider" || code?.startsWith("AI_PROVIDER_")) {
    return makeUserFacingError({
      details,
      message,
      title: "Model provider error"
    });
  }

  return makeUserFacingError({
    details,
    message,
    title: "Something went wrong"
  });
};

const formatErrorDetails = (details: unknown) => {
  if (typeof details === "string") {
    return details;
  }

  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
};

class StreamResponseError extends Error {
  payload: FailedStreamPayload | null;

  constructor(message: string, payload: FailedStreamPayload | null = null) {
    super(message);
    this.name = "StreamResponseError";
    this.payload = payload;
  }
}

const getStreamErrorMessage = (payload: FailedStreamPayload) => {
  return normalizeUserFacingError(payload).message;
};

const createConversation = async (title: string) => {
  const response = await apiFetch(`${API_BASE_URL}/conversations`, {
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
  const response = await apiFetch(`${API_BASE_URL}/conversations`);

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
  const response = await apiFetch(`${API_BASE_URL}/conversations/${conversationId}`, {
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
  const response = await apiFetch(`${API_BASE_URL}/conversations/${conversationId}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
};

const shareConversation = async (conversationId: string) => {
  const response = await apiFetch(`${API_BASE_URL}/conversations/${conversationId}/share`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as ConversationShareResponse;
};

const getSharedConversation = async (shareToken: string) => {
  const response = await apiFetch(`${API_BASE_URL}/shared/conversations/${shareToken}`);

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as SharedConversationResponse;
};

const getPathMessages = async (pathId: string) => {
  const response = await apiFetch(`${API_BASE_URL}/paths/${pathId}/messages`);

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as PathMessagesResponse;
};

const getPathContextPreview = async (pathId: string) => {
  const response = await apiFetch(`${API_BASE_URL}/paths/${pathId}/context`);

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as ContextPreviewResponse;
};

const getLocalModels = async () => {
  const response = await apiFetch(`${API_BASE_URL}/models/chat`);

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as LocalModelsResponse;
};

const getConversationPaths = async (conversationId: string) => {
  const response = await apiFetch(`${API_BASE_URL}/conversations/${conversationId}/paths`);

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as ConversationPathsResponse;
};

const getConversationMerges = async (conversationId: string) => {
  const response = await apiFetch(`${API_BASE_URL}/conversations/${conversationId}/merges`);

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as ConversationMergesResponse;
};

const getServerConversationViewState = async (conversationId: string) => {
  const response = await apiFetch(`${API_BASE_URL}/conversations/${conversationId}/view-state`);

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
  const response = await apiFetch(`${API_BASE_URL}/conversations/${conversationId}/view-state`, {
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
  const response = await apiFetch(`${API_BASE_URL}/merges/${mergeId}`);

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
  const response = await apiFetch(`${API_BASE_URL}/admin/observability/summary`, {
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

  const response = await apiFetch(`${API_BASE_URL}/admin/observability/runs?${params.toString()}`, {
    headers: {
      "X-Admin-Key": adminKey
    }
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as ObservabilityRunsResponse;
};

const getObservabilityRunDetail = async ({
  adminKey,
  runId
}: {
  adminKey: string;
  runId: string;
}) => {
  const response = await apiFetch(`${API_BASE_URL}/admin/observability/runs/${runId}`, {
    headers: {
      "X-Admin-Key": adminKey
    }
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as ModelRunDetailResponse;
};

const searchWorkspace = async (query: string) => {
  const params = new URLSearchParams({
    limit: "24",
    q: query
  });
  const response = await apiFetch(`${API_BASE_URL}/search?${params.toString()}`);

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as SearchResponse;
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
  const response = await apiFetch(`${API_BASE_URL}/paths/${pathId}/branch`, {
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
  modelName,
  thinkingEnabled,
  sourcePathId,
  targetPathId
}: {
  acknowledgeOutdated?: boolean;
  mergeMode: MergeMode;
  modelName?: string | null;
  thinkingEnabled?: boolean;
  sourcePathId: string;
  targetPathId?: string;
}) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), MERGE_REQUEST_TIMEOUT_MS);

  try {
    const response = await apiFetch(`${API_BASE_URL}/merges`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        acknowledgeOutdated,
        mergeMode,
        ...(modelName ? { modelName } : {}),
        thinkingEnabled: Boolean(thinkingEnabled),
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

const readStreamedMessageResponse = async (
  response: Response,
  handlers: StreamMessageHandlers
) => {
  const contentType = response.headers.get("content-type") ?? "";
  const isEventStream = contentType.includes("text/event-stream");

  if ((!response.ok && !isEventStream) || !response.body) {
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
      | { text?: string }
      | FailedStreamPayload
      | StartedStreamPayload
      | CompletedStreamPayload;

    if (eventName === "run.started") {
      handlers.onStarted?.(payload as StartedStreamPayload);
      return;
    }

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
      const failedPayload = payload as FailedStreamPayload;
      throw new StreamResponseError(getStreamErrorMessage(failedPayload), failedPayload);
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

const streamPathMessage = async (
  pathId: string,
  content: string,
  handlers: StreamMessageHandlers,
  signal?: AbortSignal,
  webSearchEnabled = false,
  attachments: MessageAttachment[] = [],
  modelName?: string | null,
  thinkingEnabled = false
) => {
  const response = await apiFetch(`${API_BASE_URL}/paths/${pathId}/messages/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      attachments,
      content,
      ...(modelName ? { modelName } : {}),
      thinkingEnabled,
      webSearchEnabled
    }),
    signal
  });

  await readStreamedMessageResponse(response, handlers);
};

const streamEditedMessageRegeneration = async (
  pathId: string,
  messageId: string,
  content: string,
  handlers: StreamMessageHandlers,
  signal?: AbortSignal,
  modelName?: string | null,
  thinkingEnabled = false
) => {
  const response = await apiFetch(
    `${API_BASE_URL}/paths/${pathId}/messages/${messageId}/edit/regenerate/stream`,
    {
      body: JSON.stringify({
        content,
        ...(modelName ? { modelName } : {}),
        thinkingEnabled
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST",
      signal
    }
  );

  await readStreamedMessageResponse(response, handlers);
};

const selectAssistantVariant = async (
  pathId: string,
  messageId: string,
  variantNo: number
) => {
  const response = await apiFetch(
    `${API_BASE_URL}/paths/${pathId}/messages/${messageId}/variant`,
    {
      body: JSON.stringify({ variantNo }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "PATCH"
    }
  );

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  return (await response.json()) as MessageUpdateResponse;
};

const streamAssistantRegeneration = async (
  pathId: string,
  messageId: string,
  handlers: StreamMessageHandlers,
  signal?: AbortSignal,
  modelName?: string | null,
  thinkingEnabled = false
) => {
  const response = await apiFetch(
    `${API_BASE_URL}/paths/${pathId}/messages/${messageId}/regenerate/stream`,
    {
      body: JSON.stringify({
        ...(modelName ? { modelName } : {}),
        thinkingEnabled
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST",
      signal
    }
  );

  await readStreamedMessageResponse(response, handlers);
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

const formatFileSize = (size: number) => {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const isTextLikeFile = (file: File) =>
  file.type.startsWith("text/") ||
  /\.(csv|json|log|md|txt|xml|yaml|yml)$/i.test(file.name);

const isImageLikeFile = (file: File) =>
  file.type.startsWith("image/") ||
  /\.(avif|gif|jpe?g|png|webp)$/i.test(file.name);

const isImageAttachment = (attachment: Pick<MessageAttachment, "kind" | "mimeType" | "name">) =>
  attachment.kind === "image" ||
  attachment.mimeType.startsWith("image/") ||
  /\.(avif|gif|jpe?g|png|webp)$/i.test(attachment.name);

const readFileAsDataUrl = async (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Failed to read image preview."));
    });
    reader.addEventListener("error", () => reject(new Error("Failed to read image preview.")));
    reader.readAsDataURL(file);
  });

const createAttachmentUrl = (url?: string) => {
  if (!url) {
    return undefined;
  }

  return url.startsWith("http") ? url : `${API_BASE_URL}${url}`;
};

const createTextAttachment = ({
  content,
  name,
  source
}: {
  content: string;
  name: string;
  source: ComposerAttachment["source"];
}): ComposerAttachment => {
  const truncated = content.length > MAX_ATTACHMENT_TEXT_CHARS;
  const contentText = truncated ? content.slice(0, MAX_ATTACHMENT_TEXT_CHARS) : content;

  return {
    contentText,
    id: createOptimisticId("attachment"),
    kind: "file",
    mimeType: "text/plain",
    name,
    size: new Blob([content]).size,
    source,
    textTruncated: truncated,
    uploadData: `data:text/plain;base64,${btoa(unescape(encodeURIComponent(content)))}`
  };
};

const readFileAsComposerAttachment = async (file: File): Promise<ComposerAttachment> => {
  const uploadData = await readFileAsDataUrl(file);

  if (isImageLikeFile(file)) {
    if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
      throw new Error(
        `${file.name || "Image"} is too large for inline preview. Use an image under ${formatFileSize(MAX_IMAGE_ATTACHMENT_BYTES)}.`
      );
    }

    return {
      contentText: null,
      dataUrl: uploadData,
      id: createOptimisticId("attachment"),
      kind: "image",
      mimeType: file.type || "image/*",
      name: file.name || "Attached image",
      size: file.size,
      source: "file",
      uploadData
    };
  }

  if (!isTextLikeFile(file)) {
    return {
      contentText: null,
      id: createOptimisticId("attachment"),
      kind: "file",
      mimeType: file.type || "application/octet-stream",
      name: file.name || "Attached file",
      size: file.size,
      source: "file",
      uploadData
    };
  }

  const text = await file.text();
  return createTextAttachment({
    content: text,
    name: file.name || "attached-text.txt",
    source: "file"
  });
};

const toMessageAttachment = (attachment: ComposerAttachment): MessageAttachment => ({
  id: attachment.id,
  kind: attachment.kind,
  mimeType: attachment.mimeType,
  name: attachment.name,
  size: attachment.size,
  source: attachment.source,
  sourceUrl: attachment.sourceUrl,
  thumbnailUrl: attachment.thumbnailUrl
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const getAssistantLineageSummary = (message: Pick<Message, "contentJson">) => {
  const lineage = message.contentJson?.lineage;

  if (!isRecord(lineage)) {
    return null;
  }

  const currentVariantNo =
    typeof lineage.currentVariantNo === "number" && Number.isFinite(lineage.currentVariantNo)
      ? lineage.currentVariantNo
      : null;
  const variants = Array.isArray(lineage.variants) ? lineage.variants : [];

  if (!currentVariantNo || variants.length <= 1) {
    return null;
  }

  const currentVariant = variants.find(
    (variant) => isRecord(variant) && variant.variantNo === currentVariantNo
  );
  const previousVariant =
    currentVariantNo > 1
      ? variants.find(
          (variant) => isRecord(variant) && variant.variantNo === currentVariantNo - 1
        )
      : null;

  return {
    currentVariantNo,
    currentVariant,
    contextDiff: getVariantContextDiff(currentVariant, previousVariant),
    previousVariantNo: currentVariantNo > 1 ? currentVariantNo - 1 : null,
    nextVariantNo: currentVariantNo < variants.length ? currentVariantNo + 1 : null,
    totalVariants: variants.length
  };
};

const getContextMetric = (context: Record<string, unknown> | null, key: string) => {
  if (!context) {
    return null;
  }

  const value = context[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.length;
  }

  if (typeof value === "string") {
    return value ? 1 : 0;
  }

  return null;
};

const getVariantContextDiff = (current: unknown, previous: unknown) => {
  if (!isRecord(current)) {
    return null;
  }

  const currentContext = isRecord(current.contextBundle) ? current.contextBundle : null;
  const previousContext = isRecord(previous) && isRecord(previous.contextBundle)
    ? previous.contextBundle
    : null;

  if (!currentContext) {
    return null;
  }

  if (!previousContext) {
    return {
      label: "Context captured",
      title: [
        `Tokens: ${getContextMetric(currentContext, "estimatedTokens") ?? "unknown"}`,
        `Recent messages: ${getContextMetric(currentContext, "recentMessages") ?? "unknown"}`,
        `Memories: ${getContextMetric(currentContext, "memories") ?? 0}`,
        `Dropped: ${getContextMetric(currentContext, "droppedItems") ?? 0}`
      ].join("\n")
    };
  }

  const metrics = [
    ["tokens", "estimatedTokens"],
    ["recent", "recentMessages"],
    ["memories", "memories"],
    ["dropped", "droppedItems"],
    ["cache", "cacheCandidates"]
  ] as const;
  const changes = metrics
    .map(([label, key]) => {
      const currentValue = getContextMetric(currentContext, key);
      const previousValue = getContextMetric(previousContext, key);

      if (currentValue === null || previousValue === null || currentValue === previousValue) {
        return null;
      }

      const delta = currentValue - previousValue;
      return `${delta > 0 ? "+" : ""}${delta} ${label}`;
    })
    .filter((change): change is string => Boolean(change));
  const structuralChanges = [
    currentContext.compactionArtifactId !== previousContext.compactionArtifactId
      ? "compaction changed"
      : null,
    currentContext.snapshotId !== previousContext.snapshotId ? "snapshot changed" : null,
    currentContext.purpose !== previousContext.purpose ? "purpose changed" : null
  ].filter((change): change is string => Boolean(change));
  const allChanges = [...changes, ...structuralChanges];

  return {
    label: allChanges.length > 0 ? allChanges.slice(0, 2).join(", ") : "Context unchanged",
    title:
      allChanges.length > 0
        ? allChanges.join("\n")
        : "The captured context summary matches the previous variant."
  };
};

const parseMessageAttachment = (value: unknown): MessageAttachment | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === "string" ? value.id : createOptimisticId("attachment");
  const name = typeof value.name === "string" && value.name.trim() ? value.name : "Attachment";
  const mimeType = typeof value.mimeType === "string" ? value.mimeType : "application/octet-stream";
  const size = typeof value.size === "number" && Number.isFinite(value.size) ? value.size : 0;
  const kind = value.kind === "image" || mimeType.startsWith("image/") ? "image" : "file";
  const dataUrl =
    typeof value.dataUrl === "string" && value.dataUrl.startsWith("data:image/")
      ? value.dataUrl
      : undefined;
  const source = value.source === "clipboard" || value.source === "file" ? value.source : undefined;
  const sourceUrl = typeof value.sourceUrl === "string" ? value.sourceUrl : undefined;
  const thumbnailUrl = typeof value.thumbnailUrl === "string" ? value.thumbnailUrl : undefined;

  return {
    dataUrl,
    id,
    kind,
    mimeType,
    name,
    size,
    source,
    sourceUrl,
    thumbnailUrl
  };
};

const getMessageAttachments = (message: Pick<Message, "contentJson">) => {
  const attachments = message.contentJson?.attachments;

  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments
    .map(parseMessageAttachment)
    .filter((attachment): attachment is MessageAttachment => Boolean(attachment));
};

const uploadComposerAttachment = async (pathId: string, attachment: ComposerAttachment) => {
  if (attachment.sourceUrl) {
    return attachment;
  }

  const data =
    attachment.uploadData ??
    attachment.dataUrl ??
    (attachment.contentText
      ? `data:text/plain;base64,${btoa(unescape(encodeURIComponent(attachment.contentText)))}`
      : null);

  if (!data) {
    throw new Error(`Could not upload ${attachment.name}.`);
  }

  const response = await apiFetch(`${API_BASE_URL}/paths/${pathId}/attachments`, {
    body: JSON.stringify({
      data,
      mimeType: attachment.mimeType,
      name: attachment.name,
      size: attachment.size,
      source: attachment.source
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errorBody?.error ?? `Failed to upload ${attachment.name}.`);
  }

  const result = (await response.json()) as { attachment: MessageAttachment };

  return {
    ...attachment,
    id: result.attachment.id,
    kind: result.attachment.kind,
    mimeType: result.attachment.mimeType,
    name: result.attachment.name,
    size: result.attachment.size,
    sourceUrl: result.attachment.sourceUrl,
    thumbnailUrl: result.attachment.thumbnailUrl
  };
};

const buildPromptWithComposerContext = ({
  attachments,
  text,
  webSearchEnabled
}: {
  attachments: ComposerAttachment[];
  text: string;
  webSearchEnabled: boolean;
}) => {
  const sections: string[] = [];
  const trimmedText = text.trim();

  if (trimmedText) {
    sections.push(trimmedText);
  }

  if (webSearchEnabled) {
    sections.push("[Web search requested]\nUse current web information if available.");
  }

  for (const attachment of attachments) {
    const header = `Attached file: ${attachment.name} (${attachment.mimeType || "unknown type"}, ${formatFileSize(attachment.size)})`;
    const body = attachment.contentText
      ? `${attachment.contentText}${attachment.textTruncated ? "\n\n[Attachment text truncated.]" : ""}`
      : "[File contents unavailable in this chat. Use the file name and metadata only.]";

    sections.push(`${header}\n\n${body}`);
  }

  const composed = sections.join("\n\n---\n\n").trim();

  if (composed.length <= MAX_COMPOSED_PROMPT_CHARS) {
    return composed;
  }

  return `${composed.slice(0, MAX_COMPOSED_PROMPT_CHARS)}\n\n[Prompt truncated because attachments were too large.]`;
};

const stripMarkdownForReadability = (value: string) =>
  value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/[#>*_|~[\]()`-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const countSyllables = (word: string) => {
  const normalized = word.toLowerCase().replace(/[^a-z]/g, "");

  if (!normalized) {
    return 0;
  }

  if (normalized.length <= 3) {
    return 1;
  }

  const withoutSilentE = normalized.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/u, "");
  const syllableGroups = withoutSilentE.match(/[aeiouy]+/g);
  return Math.max(1, syllableGroups?.length ?? 1);
};

const getSmogReadingLevel = (content: string) => {
  const text = stripMarkdownForReadability(content);

  if (!text) {
    return null;
  }

  const sentenceCount = Math.max(1, text.split(/[.!?]+/).filter((item) => item.trim()).length);
  const polysyllableCount = text
    .split(/\s+/)
    .filter((word) => countSyllables(word) >= 3).length;

  if (polysyllableCount === 0) {
    return {
      grade: 1,
      label: "Grade 1",
      level: "early elementary school"
    };
  }

  const grade = Math.round(1.043 * Math.sqrt(polysyllableCount * (30 / sentenceCount)) + 3.1291);
  const clampedGrade = Math.max(1, grade);
  const label = clampedGrade >= 13 ? "Grade 13+" : `Grade ${clampedGrade}`;
  const level =
    clampedGrade >= 13
      ? "college"
      : clampedGrade >= 9
        ? "high school"
        : clampedGrade >= 6
          ? "middle school"
          : "elementary school";

  return {
    grade: clampedGrade,
    label,
    level
  };
};

const SmogGradeBadge = ({ content }: { content: string }) => {
  const readingLevel = getSmogReadingLevel(content);

  if (!readingLevel) {
    return null;
  }

  const tooltip = `SMOG ${readingLevel.label} (${readingLevel.level})`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="smog-grade-badge"
          tabIndex={0}
          title={tooltip}
        >
          <BookOpen aria-hidden="true" />
          <span>{readingLevel.label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="smog-grade-tooltip" side="top" sideOffset={8}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
};

const writeClipboardText = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
};

const isAbortError = (error: unknown) =>
  error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";

const getMessageResilience = (message: Message) => {
  const resilience = message.contentJson?.resilience;

  if (!resilience || typeof resilience !== "object" || Array.isArray(resilience)) {
    return null;
  }

  const record = resilience as {
    error?: ApiErrorShape;
    modelRunId?: string | null;
    partial?: boolean;
  };

  return {
    error: record.error ?? null,
    modelRunId: record.modelRunId ?? null,
    partial: Boolean(record.partial)
  };
};

const getMessageFailureText = (message: Message) => {
  const resilience = getMessageResilience(message);

  return normalizeUserFacingError(
    resilience?.error ?? "The assistant response failed."
  ).message;
};

const isFailedAssistantMessage = (message: Message) =>
  message.role === "assistant" && message.status === "failed";

const formatSearchSourceType = (sourceType: SearchResult["sourceType"]) => {
  switch (sourceType) {
    case "attachment":
      return "Attachment";
    case "conversation":
      return "Conversation";
    case "memory_artifact":
      return "Memory";
    case "message":
      return "Message";
    case "path":
      return "Path";
    case "path_snapshot":
      return "Snapshot";
  }
};

const isSourceReference = (value: unknown): value is SourceReference => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.conversationId === "string" &&
    typeof value.label === "string" &&
    (typeof value.pathId === "string" || value.pathId === null) &&
    typeof value.sourceId === "string" &&
    typeof value.sourceType === "string"
  );
};

const getMessageSources = (message: Pick<Message, "contentJson">) => {
  const sources = message.contentJson?.sources;

  if (!Array.isArray(sources)) {
    return [];
  }

  return sources.filter(isSourceReference);
};

const getVisibleCitationSources = (message: Pick<Message, "contentJson">) =>
  getMessageSources(message).filter((source) => source.sourceType === "search_result");

const getCitationSourceLabel = (source: SourceReference) => {
  switch (source.sourceType) {
    case "attachment":
      return "Attachment";
    case "branch_snapshot":
      return "Snapshot";
    case "compacted_memory":
      return "Compaction";
    case "merge_memory":
      return "Merge";
    case "message":
      return "Message";
    case "retrieval_result":
      return "Retrieved";
    case "search_result":
      return "Search";
    default:
      return "Source";
  }
};

const getCitationOriginType = (source: SourceReference) => {
  const originType = source.metadata?.sourceType;
  return typeof originType === "string" ? originType : source.sourceType;
};

const getRecordArray = (value: unknown, key: string) => {
  if (!isRecord(value)) {
    return [];
  }

  const maybeArray = value[key];

  return Array.isArray(maybeArray)
    ? maybeArray.filter((item): item is Record<string, unknown> => isRecord(item))
    : [];
};

const getRecordString = (value: Record<string, unknown>, key: string) => {
  const item = value[key];
  return typeof item === "string" ? item : null;
};

const getRecordNumber = (value: Record<string, unknown>, key: string) => {
  const item = value[key];
  return typeof item === "number" && Number.isFinite(item) ? item : null;
};

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

const UserMessageContent = ({
  attachments = [],
  content,
  onOpenImage
}: {
  attachments?: MessageAttachment[];
  content: string;
  onOpenImage?: (preview: ImagePreview) => void;
}) => {
  const sections = content.split(/\n\n---\n\n/g);
  const textSections: string[] = [];
  const attachmentSections: Array<{ name: string; meta: string }> = [];
  let hasWebSearchRequest = false;

  for (const section of sections) {
    if (section.startsWith("[Web search requested]")) {
      hasWebSearchRequest = true;
      continue;
    }

    const attachmentMatch = section.match(/^Attached file: (.+?) \((.+?)\)\n\n/);

    if (attachmentMatch) {
      attachmentSections.push({
        name: attachmentMatch[1],
        meta: attachmentMatch[2]
      });
      continue;
    }

    if (section.trim()) {
      textSections.push(section.trim());
    }
  }

  const jsonAttachmentNames = new Set(attachments.map((attachment) => attachment.name));
  const visibleAttachmentSections = attachmentSections.filter(
    (attachment) => !jsonAttachmentNames.has(attachment.name)
  );
  const hasAttachments = attachments.length > 0 || visibleAttachmentSections.length > 0;

  const renderMessageAttachment = (attachment: MessageAttachment) => {
    const meta = `${attachment.mimeType || "unknown type"}, ${formatFileSize(attachment.size)}`;
    const imageSrc = attachment.dataUrl ?? createAttachmentUrl(attachment.thumbnailUrl ?? attachment.sourceUrl);
    const fullImageSrc = attachment.dataUrl ?? createAttachmentUrl(attachment.sourceUrl ?? attachment.thumbnailUrl);
    const canPreviewImage = isImageAttachment(attachment) && Boolean(imageSrc);

    if (canPreviewImage && imageSrc) {
      return (
        <button
          className="chat-bubble-attachment chat-bubble-attachment--image"
          key={attachment.id}
          onClick={() =>
            onOpenImage?.({
              meta,
              name: attachment.name,
              src: fullImageSrc ?? imageSrc
            })
          }
          type="button"
        >
          <img alt="" src={imageSrc} />
          <span>{attachment.name}</span>
          <small>{meta}</small>
        </button>
      );
    }

    return (
      <span className="chat-bubble-attachment" key={attachment.id}>
        {isImageAttachment(attachment) ? (
          <ImageIcon aria-hidden="true" />
        ) : (
          <FileText aria-hidden="true" />
        )}
        <span>{attachment.name}</span>
        <small>{meta}</small>
      </span>
    );
  };

  return (
    <>
      {textSections.length > 0 ? (
        textSections.map((section, index) => <p key={index}>{section}</p>)
      ) : hasAttachments || hasWebSearchRequest ? null : (
        <p>{content || "..."}</p>
      )}

      {hasWebSearchRequest || hasAttachments ? (
        <div className="chat-bubble-attachments">
          {hasWebSearchRequest ? (
            <span className="chat-bubble-attachment chat-bubble-attachment--web">
              <Globe2 aria-hidden="true" />
              <span>Web search requested</span>
            </span>
          ) : null}

          {attachments.map(renderMessageAttachment)}

          {visibleAttachmentSections.map((attachment, index) => (
            <span className="chat-bubble-attachment" key={`${attachment.name}-${index}`}>
              <FileText aria-hidden="true" />
              <span>{attachment.name}</span>
              <small>{attachment.meta}</small>
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
};

const ImagePreviewDialog = ({
  image,
  onClose
}: {
  image: ImagePreview | null;
  onClose: () => void;
}) => (
  <Dialog
    open={Boolean(image)}
    onOpenChange={(open) => {
      if (!open) {
        onClose();
      }
    }}
  >
    <DialogContent className="image-preview-dialog" showCloseButton={false}>
      {image ? (
        <>
          <div className="image-preview-dialog__header">
            <div>
              <DialogTitle>{image.name}</DialogTitle>
              <span>{image.meta}</span>
            </div>
            <Button
              aria-label="Close image preview"
              className="image-preview-dialog__close"
              onClick={onClose}
              type="button"
            >
              <X aria-hidden="true" />
            </Button>
          </div>
          <div className="image-preview-dialog__body">
            <img alt={image.name} src={image.src} />
          </div>
        </>
      ) : null}
    </DialogContent>
  </Dialog>
);

const AssistantLineageTag = ({
  message,
  onSelectVariant
}: {
  message: Message;
  onSelectVariant?: (variantNo: number) => void;
}) => {
  const lineage = getAssistantLineageSummary(message);

  if (!lineage) {
    return null;
  }

  return (
    <span className="message-variant-control">
      {onSelectVariant ? (
        <button
          aria-label="Previous response variant"
          disabled={!lineage.previousVariantNo}
          onClick={() => {
            if (lineage.previousVariantNo) {
              onSelectVariant(lineage.previousVariantNo);
            }
          }}
          type="button"
        >
          {"<"}
        </button>
      ) : null}
      <span className="message-tag message-tag--muted">
        {`Variant ${lineage.currentVariantNo}/${lineage.totalVariants}`}
      </span>
      {lineage.contextDiff ? (
        <span
          className="message-tag message-tag--muted message-tag--context-diff"
          title={lineage.contextDiff.title}
        >
          {lineage.contextDiff.label}
        </span>
      ) : null}
      {onSelectVariant ? (
        <button
          aria-label="Next response variant"
          disabled={!lineage.nextVariantNo}
          onClick={() => {
            if (lineage.nextVariantNo) {
              onSelectVariant(lineage.nextVariantNo);
            }
          }}
          type="button"
        >
          {">"}
        </button>
      ) : null}
    </span>
  );
};

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
        <Button
          className="merge-memory-card__toggle"
          onClick={() => setIsDetailsOpen((current) => !current)}
          type="button"
        >
          {isDetailsOpen ? "Hide details" : "View details"}
        </Button>
      ) : null}
      {isDetailsOpen ? (
        <div className="merge-memory-card__details">
          <MarkdownContent className="markdown-content" content={detailContent || "..."} />
        </div>
      ) : null}
    </div>
  );
};

const CitationSourceChips = ({
  message,
  onInspect
}: {
  message: Message;
  onInspect: (source: SourceReference) => void;
}) => {
  const sources = getVisibleCitationSources(message);

  if (sources.length === 0) {
    return null;
  }

  return (
    <div className="citation-row" aria-label="Sources used">
      {sources.slice(0, 6).map((source, index) => (
        <button
          className="citation-chip"
          key={`${source.sourceType}:${source.sourceId}:${index}`}
          onClick={() => onInspect(source)}
          title={source.snippet ?? source.label}
          type="button"
        >
          <BookOpen aria-hidden="true" />
          <span>{`${index + 1}. ${source.label || getCitationSourceLabel(source)}`}</span>
        </button>
      ))}
      {sources.length > 6 ? (
        <span className="citation-chip citation-chip--overflow">
          {`+${sources.length - 6}`}
        </span>
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
  const [previewImage, setPreviewImage] = useState<ImagePreview | null>(null);
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
              <Button
                className={`shared-page__path ${
                  activePath?.id === path.id ? "shared-page__path--active" : ""
                }`}
                key={path.id}
                onClick={() => onSelectPath(path.id)}
                type="button"
              >
                <span>{path.isMain ? "Main" : `Branch depth ${path.depth}`}</span>
                <strong>{path.isMain ? sharedConversation.conversation.title : path.title}</strong>
              </Button>
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
                        <SmogGradeBadge content={message.contentText} />
                        <MarkdownContent
                          className="markdown-content markdown-content--message"
                          content={message.contentText || "..."}
                        />
                        {getAssistantLineageSummary(message) ? (
                          <div className="message-chip-row">
                            <AssistantLineageTag message={message} />
                          </div>
                        ) : null}
                      </div>
                      ) : (
                        <div className="chat-bubble">
                          <UserMessageContent
                            attachments={getMessageAttachments(message)}
                            content={message.contentText || "..."}
                            onOpenImage={setPreviewImage}
                          />
                        </div>
                      )}
                    </article>
                  ))
                )}
              </div>
              <ImagePreviewDialog image={previewImage} onClose={() => setPreviewImage(null)} />
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
  <Dialog open onOpenChange={(open) => {
    if (!open) {
      onCancel();
    }
  }}>
    <DialogContent className="branch-modal__dialog" showCloseButton={false}>
      <div className="branch-modal__header">
        <DialogTitle className="branch-modal__label">Branch from selection</DialogTitle>
        <Button className="branch-modal__close" onClick={onCancel} type="button">
          Close
        </Button>
      </div>

      <p className="branch-modal__focus">{truncateText(branchDraft.focusText, 220)}</p>

      <Label className="branch-draft-field branch-draft-field--title">
        <span className="field-label">Branch Title</span>
        <Input
          className="text-input text-input--compact"
          onChange={(event) => onUpdateTitle(event.target.value)}
          value={branchDraft.title}
        />
      </Label>

      <p className="branch-modal__copy">
        This branch will continue as a regular chat from the selected point.
      </p>

      <div className="branch-modal__actions">
        <Button className="secondary-button" onClick={onCancel} type="button">
          Cancel
        </Button>
        <Button
          className="primary-button primary-button--inline"
          disabled={isCreatingBranch || isSending}
          onClick={onCreateBranch}
          type="button"
        >
          {isCreatingBranch ? "Creating branch..." : "Create Branch"}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
);

const ErrorToast = ({
  error,
  onClose,
  onCopyDetails
}: {
  error: UserFacingError;
  onClose: () => void;
  onCopyDetails: () => void;
}) => (
  <div
    aria-live="assertive"
    className={`error-toast error-toast--${error.severity}`}
    role="alert"
  >
    <div className="error-toast__icon">
      <AlertTriangle aria-hidden="true" />
    </div>
    <div className="error-toast__body">
      <strong>{error.title}</strong>
      <p>{error.message}</p>
      <div className="error-toast__actions">
        <button onClick={onCopyDetails} type="button">
          <Copy aria-hidden="true" />
          <span>Copy details</span>
        </button>
      </div>
    </div>
    <button
      aria-label="Dismiss error"
      className="error-toast__close"
      onClick={onClose}
      type="button"
    >
      <X aria-hidden="true" />
    </button>
  </div>
);

const BranchableMarkdownContent = ({
  branchDraft,
  className,
  content,
  isBranchingEnabled,
  message,
  onCopyBlock,
  onOpenBranchDraft
}: {
  branchDraft: BranchDraft | null;
  className?: string;
  content: string;
  isBranchingEnabled: boolean;
  message: Message;
  onCopyBlock: (text: string) => void;
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
    isBranchingEnabled && focusText && offsets ? (
      <Button
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
      </Button>
    ) : null;

  const getBlockMarkdown = (offsets: { end: number; start: number } | null) => {
    if (!offsets) {
      return "";
    }

    return content.slice(offsets.start, offsets.end).trim();
  };

  const renderCopyAction = ({
    markdown,
    placement,
    title = "Copy block"
  }: {
    markdown: string;
    placement: "inline" | "surface";
    title?: string;
  }) =>
    markdown ? (
      <Button
        aria-label={title}
        className={`block-copy-action block-copy-action--${placement}`}
        onClick={() => onCopyBlock(markdown)}
        title={title}
        type="button"
      >
        <Copy aria-hidden="true" />
      </Button>
    ) : null;

  const renderInlineActions = (actions: ReactNode[]) => {
    const visibleActions = actions.filter(Boolean);

    if (visibleActions.length === 0) {
      return null;
    }

    return (
      <span className="branchable-inline-actions">
        {visibleActions.map((action, index) => (
          <span className="branchable-action-slot" key={index}>
            {action}
          </span>
        ))}
      </span>
    );
  };

  const renderSurfaceActions = (actions: ReactNode[]) => {
    const visibleActions = actions.filter(Boolean);

    if (visibleActions.length === 0) {
      return null;
    }

    return (
      <div className="branchable-surface-actions">
        {visibleActions.map((action, index) => (
          <span className="branchable-action-slot" key={index}>
            {action}
          </span>
        ))}
      </div>
    );
  };

  const renderBranchableHeading = (
    tagName: "h1" | "h2" | "h3" | "h4",
    children: ReactNode,
    node: { position?: { end?: { offset?: number }; start?: { offset?: number } } } | undefined
  ) => {
    const focusText = normalizeChatText(extractNodeText(children));
    const offsets = getBlockOffsets(node);
    const blockId = createBlockId(node, tagName, focusText);
    const isActive = branchDraft?.targetId === blockId;
    const action = renderInlineActions([
      renderBranchAction({
        blockId,
        blockType: tagName,
        focusText,
        offsets,
        placement: "inline",
        title: "Create branch from this heading"
      })
    ]);

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

  const renderBranchableList = (
    tagName: "ol" | "ul",
    children: ReactNode,
    node: { position?: { end?: { offset?: number }; start?: { offset?: number } } } | undefined
  ) => {
    return (
      <div className="branchable-list-block">
        {tagName === "ol" ? <ol>{children}</ol> : <ul>{children}</ul>}
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
        className={`branchable-block branchable-block--surface branchable-block--${tagName} ${
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

        {renderSurfaceActions([
          tagName === "pre" || tagName === "table"
            ? renderCopyAction({
                markdown: getBlockMarkdown(offsets),
                placement: "surface",
                title: tagName === "pre" ? "Copy code block" : "Copy table"
              })
            : null,
          renderBranchAction({
            blockId,
            blockType: tagName,
            focusText,
            offsets,
            placement: "surface",
            title: "Create branch from this section"
          })
        ])}
      </div>
    );
  };

  const components: Components = {
    blockquote: ({ children, node }) => renderBranchableBlock("blockquote", children, node),
    h1: ({ children, node }) => renderBranchableHeading("h1", children, node),
    h2: ({ children, node }) => renderBranchableHeading("h2", children, node),
    h3: ({ children, node }) => renderBranchableHeading("h3", children, node),
    h4: ({ children, node }) => renderBranchableHeading("h4", children, node),
    ol: ({ children, node }) => renderBranchableList("ol", children, node),
    ul: ({ children, node }) => renderBranchableList("ul", children, node),
    li: ({ children, node }) => {
      const focusText = normalizeChatText(extractNodeText(children));
      const offsets = getBlockOffsets(node);
      const blockId = createBlockId(node, "li", focusText);
      const isActive = branchDraft?.targetId === blockId;
      const action = renderInlineActions([
        renderBranchAction({
          blockId,
          blockType: "li",
          focusText,
          offsets,
          placement: "inline",
          title: "Create branch from this list item"
        })
      ]);

      return (
        <li
          className={`branchable-list-item branchable-block ${
            isActive ? "branchable-block--active" : ""
          }`}
        >
          {children}
          {action}
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
  const composerFileInputRef = useRef<HTMLInputElement | null>(null);
  const composerMenuRef = useRef<HTMLDivElement | null>(null);
  const composerModelRef = useRef<HTMLDivElement | null>(null);
  const messageEditInputRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const activePathIdRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const messageCacheByPathIdRef = useRef<MessageCacheByPathId>({});
  const streamingPathIdsRef = useRef<Set<string>>(new Set());
  const streamAbortControllersRef = useRef<Record<string, AbortController>>({});
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
  const [draftsByPathId, setDraftsByPathId] = useState<DraftByPathId>({});
  const [composerAttachmentsByPathId, setComposerAttachmentsByPathId] =
    useState<ComposerAttachmentsByPathId>({});
  const [previewImage, setPreviewImage] = useState<ImagePreview | null>(null);
  const [webSearchByPathId, setWebSearchByPathId] = useState<Record<string, boolean>>({});
  const [localModels, setLocalModels] = useState<LocalModelOption[]>([]);
  const [isLocalModelSelectorEnabled, setIsLocalModelSelectorEnabled] = useState(false);
  const [isLoadingLocalModels, setIsLoadingLocalModels] = useState(false);
  const [localModelsError, setLocalModelsError] = useState<string | null>(null);
  const [activeModelProvider, setActiveModelProvider] = useState<string | null>(null);
  const [doesSelectedProviderSupportThinking, setDoesSelectedProviderSupportThinking] =
    useState(false);
  const [selectedLocalModelName, setSelectedLocalModelName] = useState<string | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }

    return window.localStorage.getItem(LOCAL_MODEL_STORAGE_KEY);
  });
  const [isThinkingEnabled, setIsThinkingEnabled] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.localStorage.getItem(MODEL_THINKING_STORAGE_KEY) === "true";
  });
  const [isComposerMenuOpen, setIsComposerMenuOpen] = useState(false);
  const [isLocalModelMenuOpen, setIsLocalModelMenuOpen] = useState(false);
  const [editingMessageDraft, setEditingMessageDraft] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pendingSearchMessageId, setPendingSearchMessageId] = useState<string | null>(null);
  const [citationPreview, setCitationPreview] = useState<CitationPreview | null>(null);
  const [status, setStatus] = useState("Create a conversation to begin.");
  const [error, setErrorState] = useState<UserFacingError | null>(null);
  const setError = (value: unknown) => {
    setErrorState(value ? normalizeUserFacingError(value) : null);
  };
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [isSavingMessageEdit, setIsSavingMessageEdit] = useState(false);
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
  const [selectedRunDetail, setSelectedRunDetail] = useState<ModelRunDetailResponse | null>(null);
  const [isRunDetailLoading, setIsRunDetailLoading] = useState(false);
  const [pathContextPreview, setPathContextPreview] = useState<ContextPreviewResponse | null>(null);
  const [isPathContextLoading, setIsPathContextLoading] = useState(false);
  const [pathContextError, setPathContextError] = useState<string | null>(null);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeConfirmation, setMergeConfirmation] =
    useState<MergeConfirmationResponse | null>(null);
  const [mergeSuccessNotice, setMergeSuccessNotice] = useState<{
    sourcePathTitle: string;
    targetPathId: string;
    targetPathTitle: string;
  } | null>(null);
  const [streamingPathIds, setStreamingPathIds] = useState<string[]>([]);
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

  const draft = activePathId ? draftsByPathId[activePathId] ?? "" : "";
  const activeComposerAttachments = activePathId
    ? composerAttachmentsByPathId[activePathId] ?? []
    : [];
  const latestEditableUserMessageId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];

      if (message.role !== "user" || message.messageType !== "chat") {
        continue;
      }

      const followingMessage = messages[index + 1];

      return followingMessage?.role === "assistant" &&
        followingMessage.messageType === "chat"
        ? message.id
        : null;
    }

    return null;
  }, [messages]);
  const isWebSearchAvailable = activeModelProvider === "google";
  const isWebSearchEnabled =
    isWebSearchAvailable && activePathId ? Boolean(webSearchByPathId[activePathId]) : false;
  const isSending = activePathId ? streamingPathIds.includes(activePathId) : false;
  const selectedLocalModel =
    localModels.find((model) => model.name === selectedLocalModelName) ?? null;
  const selectedChatModelName =
    isLocalModelSelectorEnabled && selectedLocalModel ? selectedLocalModel.name : null;
  const doesSelectedModelSupportThinking =
    doesSelectedProviderSupportThinking &&
    (selectedLocalModel?.supportsThinking ?? doesSelectedProviderSupportThinking);
  const selectedThinkingEnabled =
    isLocalModelSelectorEnabled && doesSelectedModelSupportThinking && isThinkingEnabled;
  const isHostedModelSelector = activeModelProvider === "google";
  const modelSelectorTitle = isHostedModelSelector ? "Hosted models" : "Gemma 4";
  const selectedLocalModelLabel = selectedLocalModel
    ? isHostedModelSelector
      ? selectedLocalModel.label
      : selectedLocalModel.label
          .replace(/^Gemma 4\s*/u, "")
          .trim()
    : isLoadingLocalModels
      ? "Loading"
      : modelSelectorTitle;
  const selectedModelModeLabel = selectedThinkingEnabled ? "Thinking" : "Fast";
  const isLocalModelControlDisabled =
    !conversation || isSending || isLoadingLocalModels || localModels.length === 0;

  const setActiveDraft = (value: string) => {
    if (!activePathId) {
      return;
    }

    setDraftsByPathId((current) => ({
      ...current,
      [activePathId]: value
    }));
  };

  const setDraftForPath = (pathId: string, value: string) => {
    setDraftsByPathId((current) => ({
      ...current,
      [pathId]: value
    }));
  };

  const addComposerAttachments = (pathId: string, attachments: ComposerAttachment[]) => {
    if (attachments.length === 0) {
      return;
    }

    setComposerAttachmentsByPathId((current) => ({
      ...current,
      [pathId]: [...(current[pathId] ?? []), ...attachments]
    }));
  };

  const removeComposerAttachment = (pathId: string, attachmentId: string) => {
    setComposerAttachmentsByPathId((current) => ({
      ...current,
      [pathId]: (current[pathId] ?? []).filter((attachment) => attachment.id !== attachmentId)
    }));
  };

  const clearComposerContextForPath = (pathId: string) => {
    setComposerAttachmentsByPathId((current) => ({
      ...current,
      [pathId]: []
    }));
    setWebSearchByPathId((current) => ({
      ...current,
      [pathId]: false
    }));
  };

  const setPathStreaming = (pathId: string, streaming: boolean) => {
    const next = new Set(streamingPathIdsRef.current);

    if (streaming) {
      next.add(pathId);
    } else {
      next.delete(pathId);
    }

    streamingPathIdsRef.current = next;
    setStreamingPathIds([...next]);
  };

  const setPathStreamAbortController = (pathId: string, controller: AbortController) => {
    streamAbortControllersRef.current = {
      ...streamAbortControllersRef.current,
      [pathId]: controller
    };
  };

  const clearPathStreamAbortController = (pathId: string, controller: AbortController) => {
    if (streamAbortControllersRef.current[pathId] !== controller) {
      return;
    }

    const nextControllers = { ...streamAbortControllersRef.current };
    delete nextControllers[pathId];
    streamAbortControllersRef.current = nextControllers;
  };

  const setMessagesForPath = (pathId: string, nextMessages: Message[]) => {
    messageCacheByPathIdRef.current = {
      ...messageCacheByPathIdRef.current,
      [pathId]: nextMessages
    };

    if (activePathIdRef.current === pathId) {
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
    }
  };

  const updateMessagesForPath = (
    pathId: string,
    updater: (currentMessages: Message[]) => Message[]
  ) => {
    const currentMessages =
      messageCacheByPathIdRef.current[pathId] ??
      (activePathIdRef.current === pathId ? messagesRef.current : []);

    setMessagesForPath(pathId, updater(currentMessages));
  };

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
    () =>
      Boolean(activePathId) &&
      (Boolean(draft.trim()) || activeComposerAttachments.length > 0) &&
      !isSending,
    [activeComposerAttachments.length, activePathId, draft, isSending]
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
    activePathIdRef.current = pathId;
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

      activePathIdRef.current = result.mainPath.id;
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
        setMessagesForPath(result.mainPath.id, []);
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
    activePathIdRef.current = null;
    messagesRef.current = [];
    setActivePathId(null);
    setActivePath(null);
    setMessages([]);

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
      activePathIdRef.current = nextPathId;
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

  const handleSearchSubmit = async () => {
    const query = searchQuery.trim();

    if (!query || isSearchLoading) {
      return;
    }

    setIsSearchLoading(true);
    setSearchError(null);

    try {
      const result = await searchWorkspace(query);
      setSearchResults(result.results);
      setStatus(
        result.results.length > 0
          ? `${result.results.length} search results.`
          : "No search results."
      );
    } catch (searchLoadError) {
      const message =
        searchLoadError instanceof Error
          ? searchLoadError.message
          : "Failed to search chats.";
      setSearchError(message);
      setStatus("Search failed.");
    } finally {
      setIsSearchLoading(false);
    }
  };

  const handleSelectSearchResult = async (result: SearchResult) => {
    if (isCreatingConversation) {
      return;
    }

    setSearchError(null);
    setError(null);
    setStatus("Opening search result...");

    try {
      let loadedPaths = paths;

      if (conversation?.id !== result.conversationId) {
        persistLocalActivePathFallback();
        activePathIdRef.current = null;
        messagesRef.current = [];
        setActivePathId(null);
        setActivePath(null);
        setMessages([]);
        loadedPaths = await refreshConversationPaths(result.conversationId);
        await refreshConversationMerges(result.conversationId);
      }

      const fallbackPathId =
        loadedPaths.find((path) => path.isMain)?.id ?? loadedPaths[0]?.id ?? null;
      const nextPathId =
        result.pathId && loadedPaths.some((path) => path.id === result.pathId)
          ? result.pathId
          : fallbackPathId;

      if (!nextPathId) {
        throw new Error("Search result has no available path.");
      }

      pendingScrollRestoreRef.current = {
        conversationId: result.conversationId,
        pathId: nextPathId
      };
      setPendingSearchMessageId(result.sourceType === "message" ? result.sourceId : null);
      activePathIdRef.current = nextPathId;
      setActivePathId(nextPathId);
      setIsSearchOpen(false);
      setStatus("Search result opened.");

      if (isPhoneViewport()) {
        setIsSidebarCollapsed(true);
      }
    } catch (openError) {
      const message =
        openError instanceof Error ? openError.message : "Failed to open search result.";
      setSearchError(message);
      setStatus("Search result failed to open.");
    }
  };

  const handleOpenCitationSource = async (source: SourceReference) => {
    if (isCreatingConversation) {
      return;
    }

    const nextPathId = source.pathId;

    if (!nextPathId) {
      setStatus("This source has no path to open.");
      return;
    }

    setError(null);
    setStatus("Opening cited source...");

    try {
      let loadedPaths = paths;

      if (conversation?.id !== source.conversationId) {
        persistLocalActivePathFallback();
        activePathIdRef.current = null;
        messagesRef.current = [];
        setActivePathId(null);
        setActivePath(null);
        setMessages([]);
        loadedPaths = await refreshConversationPaths(source.conversationId);
        await refreshConversationMerges(source.conversationId);
      }

      if (!loadedPaths.some((path) => path.id === nextPathId)) {
        throw new Error("Cited source path is no longer available.");
      }

      const originType = getCitationOriginType(source);
      pendingScrollRestoreRef.current = {
        conversationId: source.conversationId,
        pathId: nextPathId
      };
      setPendingSearchMessageId(originType === "message" ? source.sourceId : null);
      activePathIdRef.current = nextPathId;
      setActivePathId(nextPathId);
      setCitationPreview(null);
      setStatus("Cited source opened.");

      if (isPhoneViewport()) {
        setIsSidebarCollapsed(true);
      }
    } catch (openError) {
      const message =
        openError instanceof Error ? openError.message : "Failed to open cited source.";
      setError(message);
      setStatus("Cited source failed to open.");
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
    let isCancelled = false;

    const loadLocalModels = async () => {
      setIsLoadingLocalModels(true);
      setLocalModelsError(null);

      try {
        const result = await getLocalModels();

        if (isCancelled) {
          return;
        }

        startTransition(() => {
          setActiveModelProvider(result.provider);
          setIsLocalModelSelectorEnabled(result.enabled);
          setDoesSelectedProviderSupportThinking(result.supportsThinking);
          setLocalModels(result.models);

          if (!result.enabled || result.models.length === 0) {
            setSelectedLocalModelName(null);
            setIsThinkingEnabled(false);
            return;
          }

          const storedModel =
            typeof window === "undefined"
              ? null
              : window.localStorage.getItem(LOCAL_MODEL_STORAGE_KEY);
          const nextModel =
            result.models.find((model) => model.name === storedModel)?.name ??
            result.models.find((model) => model.name === result.selectedModel)?.name ??
            result.models[0]?.name ??
            null;

          setSelectedLocalModelName(nextModel);

          if (typeof window !== "undefined" && nextModel) {
            window.localStorage.setItem(LOCAL_MODEL_STORAGE_KEY, nextModel);
          }
        });
      } catch (localModelError) {
        if (isCancelled) {
          return;
        }

        const message =
          localModelError instanceof Error
            ? localModelError.message
            : "Failed to load local Gemma 4 models.";

        setIsLocalModelSelectorEnabled(true);
        setActiveModelProvider(null);
        setDoesSelectedProviderSupportThinking(false);
        setLocalModels([]);
        setSelectedLocalModelName(null);
        setLocalModelsError(message);
      } finally {
        if (!isCancelled) {
          setIsLoadingLocalModels(false);
        }
      }
    };

    void loadLocalModels();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isWebSearchAvailable) {
      return;
    }

    setWebSearchByPathId({});
  }, [isWebSearchAvailable]);

  useEffect(() => {
    if (!error || error.persistent) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setErrorState((current) => (current?.id === error.id ? null : current));
    }, 6500);

    return () => window.clearTimeout(timeoutId);
  }, [error]);

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
    if (sharedConversationToken || typeof window === "undefined") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsSearchOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [sharedConversationToken]);

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

  useEffect(() => {
    if (!pendingSearchMessageId || messages.length === 0 || typeof window === "undefined") {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const messageElement = document.querySelector<HTMLElement>(
        `[data-message-id="${pendingSearchMessageId}"]`
      );

      if (!messageElement) {
        return;
      }

      messageElement.scrollIntoView({ behavior: "smooth", block: "center" });
      messageElement.classList.add("chat-message--search-hit");
      setPendingSearchMessageId(null);

      window.setTimeout(() => {
        messageElement.classList.remove("chat-message--search-hit");
      }, 1800);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [messages, pendingSearchMessageId]);

  useEffect(
    () => () => {
      if (viewStateSaveTimeoutRef.current) {
        window.clearTimeout(viewStateSaveTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    activePathIdRef.current = activePathId;
  }, [activePathId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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
    const isOverflowing = textarea.scrollHeight > maxHeight;

    textarea.style.maxHeight = `${maxHeight}px`;
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = isOverflowing ? "auto" : "hidden";
  }, [draft]);

  useEffect(() => {
    if (!isComposerMenuOpen || typeof document === "undefined") {
      return;
    }

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (composerMenuRef.current?.contains(target)) {
        return;
      }

      setIsComposerMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isComposerMenuOpen]);

  useEffect(() => {
    if (!isLocalModelMenuOpen || typeof document === "undefined") {
      return;
    }

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (composerModelRef.current?.contains(target)) {
        return;
      }

      setIsLocalModelMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isLocalModelMenuOpen]);

  useEffect(() => {
    if (!editingMessageId || typeof window === "undefined") {
      return;
    }

    window.requestAnimationFrame(() => {
      const textarea = messageEditInputRef.current;
      textarea?.focus();
      textarea?.setSelectionRange(editingMessageDraft.length, editingMessageDraft.length);
    });
  }, [editingMessageId]);

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
      const cachedMessages = messageCacheByPathIdRef.current[activePathId];
      const cachedPath =
        conversation?.id && activePathCatalogItem
          ? createPathSummaryFromCatalogItem(activePathCatalogItem, conversation.id)
          : null;

      if (cachedMessages) {
        messagesRef.current = cachedMessages;
        setMessages(cachedMessages);

        if (cachedPath) {
          setActivePath(cachedPath);
        }
      }

      if (streamingPathIdsRef.current.has(activePathId)) {
        setEditingMessageDraft("");
        setEditingMessageId(null);
        setStatus("Streaming assistant reply...");
        return;
      }

      setStatus("Loading path history...");

      try {
        const result = await getPathMessages(activePathId);

        if (isCancelled || streamingPathIdsRef.current.has(activePathId)) {
          return;
        }

        startTransition(() => {
          setMessagesForPath(activePathId, result.messages);
          setEditingMessageDraft("");
          setEditingMessageId(null);
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
  }, [activePathCatalogItem, activePathId, conversation?.id]);

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
    setIsLocalModelMenuOpen(false);
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

  useEffect(() => {
    if (!isOpsOverlayOpen || !activePathId) {
      setPathContextPreview(null);
      return;
    }

    let isCancelled = false;

    const loadPathContext = async () => {
      setIsPathContextLoading(true);
      setPathContextError(null);

      try {
        const preview = await getPathContextPreview(activePathId);

        if (!isCancelled) {
          setPathContextPreview(preview);
        }
      } catch (previewError) {
        if (!isCancelled) {
          setPathContextError(
            previewError instanceof Error
              ? previewError.message
              : "Failed to load path context."
          );
        }
      } finally {
        if (!isCancelled) {
          setIsPathContextLoading(false);
        }
      }
    };

    void loadPathContext();

    return () => {
      isCancelled = true;
    };
  }, [activePathId, isOpsOverlayOpen]);

  const sendPathPrompt = async (
    userText: string,
    statusMessage?: string,
    options?: {
      attachments?: MessageAttachment[];
      modelName?: string | null;
      thinkingEnabled?: boolean;
      webSearchEnabled?: boolean;
    }
  ) => {
    if (
      !activePathId ||
      !userText.trim() ||
      streamingPathIdsRef.current.has(activePathId)
    ) {
      return;
    }

    const targetPathId = activePathId;
    const targetActivePath = activePath;
    const targetConversationId = conversation?.id ?? null;
    const promptText = userText.trim();
    const messageAttachments = options?.attachments ?? [];
    const optimisticUserId = createOptimisticId("user");
    const optimisticAssistantId = createOptimisticId("assistant");
    const controller = new AbortController();
    let hasStreamStarted = false;
    let serverUserMessageId: string | null = null;

    setError(null);
    setPathStreamAbortController(targetPathId, controller);
    setPathStreaming(targetPathId, true);
    setStatus(
      statusMessage ??
        (targetActivePath?.isMain ? "Streaming assistant reply..." : "Streaming branch reply...")
    );

    startTransition(() => {
      updateMessagesForPath(targetPathId, (current) => [
        ...current,
        {
          id: optimisticUserId,
          role: "user",
          contentJson:
            messageAttachments.length > 0
              ? {
                  attachments: messageAttachments
                }
              : null,
          contentText: promptText,
          createdAt: new Date().toISOString(),
          modelName: null
        },
        {
          id: optimisticAssistantId,
          role: "assistant",
          contentText: "",
          createdAt: new Date().toISOString(),
          modelName: null,
          modelProvider: null
        }
      ]);
    });

    try {
      await streamPathMessage(
        targetPathId,
        promptText,
        {
          onStarted: (payload) => {
            hasStreamStarted = true;
            serverUserMessageId = payload.userMessageId;

            startTransition(() => {
              updateMessagesForPath(targetPathId, (current) =>
                current.map((message) =>
                  message.id === optimisticUserId
                    ? {
                        ...message,
                        id: payload.userMessageId
                      }
                    : message.id === optimisticAssistantId
                      ? {
                          ...message,
                          modelName: payload.modelName,
                          modelProvider: payload.modelProvider
                        }
                      : message
                )
              );
            });
          },
          onDelta: (text) => {
            startTransition(() => {
              updateMessagesForPath(targetPathId, (current) =>
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
                  current?.id === targetConversationId
                    ? {
                        ...current,
                        title: payload.conversationTitle ?? current.title
                      }
                    : current
                );
              }

              updateMessagesForPath(targetPathId, (current) =>
                current.map((message) => {
                  if (
                    message.id === optimisticUserId ||
                    message.id === serverUserMessageId
                  ) {
                    return payload.userMessage;
                  }

                  if (message.id === optimisticAssistantId) {
                    return payload.assistantMessage ?? message;
                  }

                  return message;
                })
              );

              if (activePathIdRef.current === targetPathId) {
                setActivePath(payload.path);
                setStatus(
                  payload.path.isMain ? "Assistant reply completed." : "Branch reply completed."
                );
              }
            });
          }
        },
        controller.signal,
        Boolean(options?.webSearchEnabled),
        messageAttachments,
        options?.modelName ?? null,
        Boolean(options?.thinkingEnabled)
      );
    } catch (sendError) {
      if (isAbortError(sendError)) {
        startTransition(() => {
          updateMessagesForPath(targetPathId, (current) =>
            current.filter((item) => {
              if (item.id === optimisticUserId && !hasStreamStarted) {
                return false;
              }

              if (item.id !== optimisticAssistantId) {
                return true;
              }

              return item.contentText.trim().length > 0;
            })
          );
        });

        if (activePathIdRef.current === targetPathId) {
          setStatus("Generation stopped.");
        }

        return;
      }

      const message =
        sendError instanceof Error ? sendError.message : "Failed to send message.";
      const streamFailure =
        sendError instanceof StreamResponseError ? sendError.payload : null;

      if (streamFailure) {
        startTransition(() => {
          updateMessagesForPath(targetPathId, (current) =>
            current.map((item) => {
              if (
                streamFailure.userMessage &&
                (item.id === optimisticUserId || item.id === serverUserMessageId)
              ) {
                return streamFailure.userMessage;
              }

              if (item.id === optimisticAssistantId) {
                return (
                  streamFailure.assistantMessage ?? {
                    ...item,
                    contentJson: {
                      resilience: {
                        error: {
                          message,
                          retryable: true,
                          type: "network"
                        },
                        modelRunId: streamFailure.runId ?? null,
                        partial: item.contentText.trim().length > 0
                      }
                    },
                    contentText:
                      item.contentText.trim() ||
                      "Assistant response failed before any text was returned.",
                    status: "failed"
                  }
                );
              }

              return item;
            })
          );
        });

        if (streamFailure.path && activePathIdRef.current === targetPathId) {
          setActivePath(streamFailure.path);
        }
      } else {
        startTransition(() => {
          updateMessagesForPath(targetPathId, (current) =>
            current.filter(
              (item) => item.id !== optimisticUserId && item.id !== optimisticAssistantId
            )
          );
        });
      }

      if (activePathIdRef.current === targetPathId) {
        setError(message);
        setStatus(streamFailure ? "Reply failed. Retry is available on the message." : "Message failed.");
      }
    } finally {
      clearPathStreamAbortController(targetPathId, controller);
      setPathStreaming(targetPathId, false);
    }
  };

  const handleStopGenerating = () => {
    if (!activePathId) {
      return;
    }

    const controller = streamAbortControllersRef.current[activePathId];

    if (!controller) {
      return;
    }

    controller.abort();
    setStatus("Stopping generation...");
  };

  const handleComposerFiles = async (files: FileList | File[]) => {
    if (!activePathId) {
      return;
    }

    const fileArray = Array.from(files);

    if (fileArray.length === 0) {
      return;
    }

    try {
      const attachments = await Promise.all(fileArray.map(readFileAsComposerAttachment));
      addComposerAttachments(activePathId, attachments);
      setStatus(
        attachments.length === 1
          ? `Attached ${attachments[0].name}.`
          : `Attached ${attachments.length} files.`
      );
    } catch (attachmentError) {
      const message =
        attachmentError instanceof Error ? attachmentError.message : "Failed to attach file.";
      setError(message);
      setStatus("File attachment failed.");
    }
  };

  const handleComposerFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;

    if (files) {
      void handleComposerFiles(files);
    }

    event.target.value = "";
    setIsComposerMenuOpen(false);
  };

  const handleComposerPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!activePathId) {
      return;
    }

    const files = Array.from(event.clipboardData.files);

    if (files.length > 0) {
      event.preventDefault();
      void handleComposerFiles(files);
      return;
    }

    const text = event.clipboardData.getData("text/plain");

    if (text.length <= LARGE_PASTE_ATTACHMENT_THRESHOLD) {
      return;
    }

    event.preventDefault();
    const attachment = createTextAttachment({
      content: text,
      name: `pasted-text-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`,
      source: "clipboard"
    });

    addComposerAttachments(activePathId, [attachment]);
    setStatus("Large pasted text attached as a .txt file.");
  };

  const handleToggleWebSearch = () => {
    if (!activePathId || !isWebSearchAvailable) {
      return;
    }

    setWebSearchByPathId((current) => ({
      ...current,
      [activePathId]: !current[activePathId]
    }));
    setIsComposerMenuOpen(false);
  };

  const handleToggleLocalModelMenu = () => {
    if (isLocalModelControlDisabled) {
      return;
    }

    setIsComposerMenuOpen(false);
    setIsLocalModelMenuOpen((current) => !current);
  };

  const handleLocalModelChange = (nextModelName: string | null) => {
    setSelectedLocalModelName(nextModelName);

    if (typeof window !== "undefined") {
      if (nextModelName) {
        window.localStorage.setItem(LOCAL_MODEL_STORAGE_KEY, nextModelName);
      } else {
        window.localStorage.removeItem(LOCAL_MODEL_STORAGE_KEY);
      }
    }
  };

  const handleModelVariantChange = (nextModelName: string, thinkingEnabled: boolean) => {
    handleLocalModelChange(nextModelName);
    setIsThinkingEnabled(thinkingEnabled);
    setIsLocalModelMenuOpen(false);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(MODEL_THINKING_STORAGE_KEY, String(thinkingEnabled));
    }
  };

  const handleSend = async () => {
    if (!activePathId || isSending) {
      return;
    }

    const targetPathId = activePathId;
    const attachments = composerAttachmentsByPathId[targetPathId] ?? [];
    const webSearchEnabled = isWebSearchAvailable && Boolean(webSearchByPathId[targetPathId]);
    const userText = buildPromptWithComposerContext({
      attachments,
      text: draft,
      webSearchEnabled
    });

    if (!userText.trim()) {
      return;
    }

    let uploadedAttachments: ComposerAttachment[];

    try {
      setStatus(attachments.length > 0 ? "Uploading attachments..." : "Preparing message...");
      uploadedAttachments = await Promise.all(
        attachments.map((attachment) => uploadComposerAttachment(targetPathId, attachment))
      );
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Attachment upload failed.");
      setStatus("Attachment upload failed.");
      return;
    }

    const messageAttachments = uploadedAttachments.map(toMessageAttachment);

    setDraftForPath(targetPathId, "");
    clearComposerContextForPath(targetPathId);
    setIsComposerMenuOpen(false);
    setIsLocalModelMenuOpen(false);
    await sendPathPrompt(
      userText,
      webSearchEnabled ? "Streaming web-grounded assistant reply..." : undefined,
      {
        attachments: messageAttachments,
        modelName: selectedChatModelName,
        thinkingEnabled: selectedThinkingEnabled,
        webSearchEnabled
      }
    );
  };

  const handleCopyMessage = async (message: Message, label: string) => {
    const text = message.contentText;

    if (!text.trim()) {
      setStatus("Nothing to copy.");
      return;
    }

    try {
      await writeClipboardText(text);

      setCopiedMessageId(message.id);
      setStatus(label);
      window.setTimeout(() => {
        setCopiedMessageId((current) => (current === message.id ? null : current));
      }, 1400);
    } catch (copyError) {
      const copyMessage =
        copyError instanceof Error ? copyError.message : "Failed to copy message.";
      setError(copyMessage);
      setStatus("Copy failed.");
    }
  };

  const handleCopyMarkdownBlock = async (text: string) => {
    if (!text.trim()) {
      setStatus("Nothing to copy.");
      return;
    }

    try {
      await writeClipboardText(text);
      setStatus("Block copied.");
    } catch (copyError) {
      const copyMessage =
        copyError instanceof Error ? copyError.message : "Failed to copy block.";
      setError(copyMessage);
      setStatus("Copy failed.");
    }
  };

  const handleCopyErrorDetails = async () => {
    if (!error) {
      return;
    }

    try {
      await writeClipboardText(formatErrorDetails(error.details));
      setStatus("Error details copied.");
    } catch (copyError) {
      const copyMessage =
        copyError instanceof Error ? copyError.message : "Failed to copy error details.";
      setError(copyMessage);
      setStatus("Copy failed.");
    }
  };

  const handleCopyMessageError = async (message: Message) => {
    const resilience = getMessageResilience(message);
    const errorText = getMessageFailureText(message);
    const runText = resilience?.modelRunId ? `\nRun: ${resilience.modelRunId}` : "";

    try {
      await writeClipboardText(`${errorText}${runText}`);
      setStatus("Error details copied.");
    } catch (copyError) {
      const copyMessage =
        copyError instanceof Error ? copyError.message : "Failed to copy error details.";
      setError(copyMessage);
      setStatus("Copy failed.");
    }
  };

  const handleInspectFailedRun = (message: Message) => {
    const resilience = getMessageResilience(message);

    setOpsStatusFilter("failed");
    setIsOpsOverlayOpen(true);
    setStatus(
      resilience?.modelRunId
        ? `Inspecting failed run ${resilience.modelRunId}.`
        : "Showing failed model runs."
    );
  };

  const handleInspectRun = async (runId: string) => {
    if (!adminApiKey.trim()) {
      setOpsError("Enter your admin key to inspect a run.");
      return;
    }

    setIsRunDetailLoading(true);
    setOpsError(null);

    try {
      const detail = await getObservabilityRunDetail({
        adminKey: adminApiKey.trim(),
        runId
      });
      setSelectedRunDetail(detail);
      setStatus(`Inspecting run ${runId}.`);
    } catch (detailError) {
      const message =
        detailError instanceof Error ? detailError.message : "Failed to inspect run.";
      setOpsError(message);
    } finally {
      setIsRunDetailLoading(false);
    }
  };

  const handleEditUserMessage = (message: Message) => {
    setEditingMessageId(message.id);
    setEditingMessageDraft(message.contentText);
    setStatus("Editing message.");
  };

  const handleCancelUserMessageEdit = () => {
    setEditingMessageDraft("");
    setEditingMessageId(null);
    setStatus("Edit cancelled.");
  };

  const handleSaveUserMessageEdit = async (message: Message) => {
    if (!activePathId || isSavingMessageEdit) {
      return;
    }

    const targetPathId = activePathId;
    const content = editingMessageDraft.trim();
    const messageIndex = messagesRef.current.findIndex((item) => item.id === message.id);
    const followingAssistantMessage =
      messageIndex >= 0 ? messagesRef.current[messageIndex + 1] : null;

    if (!content) {
      setStatus("Message cannot be empty.");
      return;
    }

    if (content === message.contentText) {
      setEditingMessageDraft("");
      setEditingMessageId(null);
      setStatus("No message changes.");
      return;
    }

    if (
      message.id !== latestEditableUserMessageId ||
      !followingAssistantMessage ||
      followingAssistantMessage.role !== "assistant" ||
      followingAssistantMessage.messageType !== "chat"
    ) {
      setStatus("Only the latest user message can be edited.");
      return;
    }

    const controller = new AbortController();

    setError(null);
    setIsSavingMessageEdit(true);
    setPathStreamAbortController(targetPathId, controller);
    setPathStreaming(targetPathId, true);
    setStatus("Saving edit and regenerating reply...");

    startTransition(() => {
      setEditingMessageDraft("");
      setEditingMessageId(null);
      updateMessagesForPath(targetPathId, (current) =>
        current.map((item) => {
          if (item.id === message.id) {
            return {
              ...item,
              contentText: content,
              status: "completed"
            };
          }

          if (item.id === followingAssistantMessage.id) {
            return {
              ...item,
              contentJson: null,
              contentText: "",
              modelName: null,
              modelProvider: null,
              status: "completed"
            };
          }

          return item;
        })
      );
    });

    try {
      await streamEditedMessageRegeneration(
        targetPathId,
        message.id,
        content,
        {
          onStarted: (payload) => {
            startTransition(() => {
              updateMessagesForPath(targetPathId, (current) =>
                current.map((item) =>
                  item.id === followingAssistantMessage.id
                    ? {
                        ...item,
                        modelName: payload.modelName,
                        modelProvider: payload.modelProvider
                      }
                    : item
                )
              );
            });
          },
          onDelta: (text) => {
            startTransition(() => {
              updateMessagesForPath(targetPathId, (current) =>
                current.map((item) =>
                  item.id === followingAssistantMessage.id
                    ? {
                        ...item,
                        contentText: `${item.contentText}${text}`
                      }
                    : item
                )
              );
            });
          },
          onCompleted: (payload) => {
            startTransition(() => {
              updateMessagesForPath(targetPathId, (current) =>
                current.map((item) => {
                  if (item.id === message.id) {
                    return payload.userMessage;
                  }

                  if (item.id === followingAssistantMessage.id) {
                    return payload.assistantMessage ?? item;
                  }

                  return item;
                })
              );

              if (activePathIdRef.current === targetPathId) {
                setActivePath(payload.path);
                setStatus("Edited message regenerated.");
              }
            });
          }
        },
        controller.signal,
        selectedChatModelName,
        selectedThinkingEnabled
      );
    } catch (saveError) {
      const saveMessage =
        saveError instanceof Error
          ? saveError.message
          : "Failed to update and regenerate message.";
      const streamFailure =
        saveError instanceof StreamResponseError ? saveError.payload : null;

      startTransition(() => {
        updateMessagesForPath(targetPathId, (current) =>
          current.map((item) => {
            if (streamFailure?.userMessage && item.id === message.id) {
              return streamFailure.userMessage;
            }

            if (item.id === followingAssistantMessage.id) {
              return (
                streamFailure?.assistantMessage ?? {
                  ...item,
                  contentJson: {
                    resilience: {
                      error: {
                        message: saveMessage,
                        retryable: true,
                        type: "network"
                      },
                      partial: item.contentText.trim().length > 0
                    }
                  },
                  contentText:
                    item.contentText.trim() ||
                    "Assistant response failed before any text was returned.",
                  status: "failed"
                }
              );
            }

            return item;
          })
        );
      });

      if (streamFailure?.path && activePathIdRef.current === targetPathId) {
        setActivePath(streamFailure.path);
      }

      setError(saveMessage);
      setStatus(
        streamFailure?.assistantMessage
          ? "Edited reply failed after partial output."
          : "Edit regeneration failed."
      );
    } finally {
      clearPathStreamAbortController(targetPathId, controller);
      setPathStreaming(targetPathId, false);
      setIsSavingMessageEdit(false);
    }
  };

  const handleRedoAssistantMessage = async (message: Message) => {
    if (!activePathId || isSending) {
      return;
    }

    const targetPathId = activePathId;
    const originalMessage = message;
    const controller = new AbortController();

    setError(null);
    setPathStreamAbortController(targetPathId, controller);
    setPathStreaming(targetPathId, true);
    setStatus("Regenerating assistant reply...");

    startTransition(() => {
      updateMessagesForPath(targetPathId, (current) =>
        current.map((item) =>
          item.id === message.id
            ? {
                ...item,
                contentText: "",
                modelName: null,
                modelProvider: null
              }
            : item
        )
      );
    });

    try {
      await streamAssistantRegeneration(
        targetPathId,
        message.id,
        {
          onStarted: (payload) => {
            startTransition(() => {
              updateMessagesForPath(targetPathId, (current) =>
                current.map((item) =>
                  item.id === message.id
                    ? {
                        ...item,
                        modelName: payload.modelName,
                        modelProvider: payload.modelProvider
                      }
                    : item
                )
              );
            });
          },
          onDelta: (text) => {
            startTransition(() => {
              updateMessagesForPath(targetPathId, (current) =>
                current.map((item) =>
                  item.id === message.id
                    ? {
                        ...item,
                        contentText: `${item.contentText}${text}`
                      }
                    : item
                )
              );
            });
          },
          onCompleted: (payload) => {
            startTransition(() => {
              updateMessagesForPath(targetPathId, (current) =>
                current.map((item) =>
                  item.id === message.id
                    ? payload.assistantMessage ?? item
                    : item
                )
              );

              if (activePathIdRef.current === targetPathId) {
                setActivePath(payload.path);
                setStatus("Assistant reply regenerated.");
              }
            });
          }
        },
        controller.signal,
        selectedChatModelName,
        selectedThinkingEnabled
      );
    } catch (redoError) {
      if (isAbortError(redoError)) {
        if (activePathIdRef.current === targetPathId) {
          setStatus("Generation stopped.");
        }

        return;
      }

      const redoMessage =
        redoError instanceof Error ? redoError.message : "Failed to regenerate response.";
      const streamFailure =
        redoError instanceof StreamResponseError ? redoError.payload : null;

      startTransition(() => {
        updateMessagesForPath(targetPathId, (current) =>
          current.map((item) =>
            item.id === message.id
              ? streamFailure?.assistantMessage ?? originalMessage
              : item
          )
        );
      });

      if (activePathIdRef.current === targetPathId) {
        setError(redoMessage);
        setStatus(
          streamFailure?.assistantMessage
            ? "Regeneration failed after partial output."
            : "Regeneration failed."
        );
      }
    } finally {
      clearPathStreamAbortController(targetPathId, controller);
      setPathStreaming(targetPathId, false);
    }
  };

  const handleSelectAssistantVariant = async (message: Message, variantNo: number) => {
    if (!activePathId || isSending) {
      return;
    }

    const targetPathId = activePathId;

    setError(null);
    setStatus("Switching response variant...");

    try {
      const result = await selectAssistantVariant(targetPathId, message.id, variantNo);

      startTransition(() => {
        updateMessagesForPath(targetPathId, (current) =>
          current.map((item) => (item.id === message.id ? result.message : item))
        );

        if (activePathIdRef.current === targetPathId) {
          setActivePath(result.path);
          setStatus("Response variant selected.");
        }
      });
    } catch (variantError) {
      const variantMessage =
        variantError instanceof Error
          ? variantError.message
          : "Failed to switch response variant.";
      setError(variantMessage);
      setStatus("Variant switch failed.");
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
        setMessagesForPath(result.path.id, []);
        setMessages([]);
        setDraftForPath(result.path.id, "");
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
        modelName: selectedChatModelName,
        thinkingEnabled: selectedThinkingEnabled,
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

  const handleOpenSidebarMenuClick = (
    event: MouseEvent<HTMLButtonElement>,
    chat: RecentChat
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    openSidebarMenu(chat, getSidebarMenuAnchor(rect));
  };

  const handleSidebarMenuActionClick = (
    event: MouseEvent<HTMLButtonElement>,
    action: SidebarChatAction
  ) => {
    event.preventDefault();
    event.stopPropagation();
    action.onSelect();
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

  const getSidebarChatActions = (chat: RecentChat): SidebarChatAction[] => [
    {
      icon: <Share2 className="chat-context-menu__svg size-3" strokeWidth={1.8} />,
      key: "share",
      label: "Share",
      onSelect: () => {
        void handleShareSidebarChat(chat);
      }
    },
    {
      icon: <Pencil className="chat-context-menu__svg size-3" strokeWidth={1.8} />,
      key: "rename",
      label: "Rename",
      onSelect: () => handleOpenRenameChat(chat)
    },
    {
      icon: chat.pinnedAt ? (
        <PinOff className="chat-context-menu__svg size-3" strokeWidth={1.8} />
      ) : (
        <Pin className="chat-context-menu__svg size-3" strokeWidth={1.8} />
      ),
      key: "pin",
      label: chat.pinnedAt ? "Unpin chat" : "Pin chat",
      onSelect: () => {
        void handleTogglePinChat(chat);
      }
    },
    {
      icon: <Trash2 className="chat-context-menu__svg size-3" strokeWidth={1.8} />,
      key: "delete",
      label: "Delete",
      onSelect: () => {
        setDeletingChat(chat);
        setSidebarMenu(null);
      },
      variant: "destructive"
    }
  ];

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
          activePathIdRef.current = null;
          messagesRef.current = [];
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
    <SidebarProvider
      open={!isSidebarCollapsed}
      onOpenChange={(open) => setIsSidebarCollapsed(!open)}
    >
      <TooltipProvider>
        <main
          className={`app-shell ${isSidebarCollapsed ? "app-shell--sidebar-collapsed" : ""}`}
        >
      <header className="mobile-navbar">
        <SidebarCollapseButton
          className="mobile-navbar__toggle"
          collapsedLabel="Open chat sidebar"
          expandedLabel="Close chat sidebar"
        />
        <span className="mobile-navbar__title">
          {conversation ? activeConversationTitle : APP_NAME}
        </span>
      </header>

      {!isSidebarCollapsed ? (
        <Button
          aria-label="Close chat sidebar"
          className="mobile-sidebar-backdrop"
          onClick={() => setIsSidebarCollapsed(true)}
          type="button"
        />
      ) : null}

      <Sidebar
        className="sidebar"
        aria-label="Chat sidebar"
        collapsible="icon"
        onPointerCancel={() => {
          mobileSidebarSwipeStartRef.current = null;
        }}
        onPointerDown={handleMobileSidebarPointerDown}
        onPointerUp={handleMobileSidebarPointerUp}
      >
        <SidebarHeader className="sidebar__topbar">
          <Button className="sidebar__logo-button" type="button" aria-label={APP_NAME}>
            <SidebarIcon name="brand" />
          </Button>
          <SidebarCollapseButton
            className="sidebar__icon-button"
          />
        </SidebarHeader>

        <SidebarContent className="sidebar__content">
          <SidebarMenu className="sidebar__quick-actions">
            <SidebarMenuItem>
              <SidebarMenuButton
                className="new-chat-button"
                disabled={isCreatingConversation}
                onClick={handleCreateConversation}
                type="button"
              >
                <SidebarIcon name="new" />
                <span>{isCreatingConversation ? "Creating..." : "New chat"}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="sidebar-search-button"
                onClick={() => setIsSearchOpen(true)}
                type="button"
              >
                <SidebarIcon name="search" />
                <span>Search chats</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          <SidebarGroup className="sidebar__section">
          <div className="sidebar__section-header">
            <SidebarGroupLabel className="sidebar__section-label">
              Recents
            </SidebarGroupLabel>
          </div>

          <SidebarMenu className="chat-list">
            {recentChats.length === 0 ? (
              <p className="sidebar__empty">
                Start a chat and its title will appear here after your opening messages.
              </p>
            ) : (
              recentChats.map((chat) => (
                <SidebarMenuItem
                  className={`chat-list-item ${conversation?.id === chat.conversationId ? "chat-list-item--active" : ""}`}
                  key={chat.conversationId}
                >
                  <SidebarMenuButton
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
                    {chat.pinnedAt ? (
                      <span className="chat-list-button__pin">
                        <Pin aria-hidden="true" strokeWidth={1.9} />
                      </span>
                    ) : null}
                  </SidebarMenuButton>
                  <Button
                    aria-label={`Open menu for ${chat.title}`}
                    className="chat-list-menu-button"
                    onClick={(event) => handleOpenSidebarMenuClick(event, chat)}
                    type="button"
                  >
                    <span />
                    <span />
                    <span />
                  </Button>
                </SidebarMenuItem>
              ))
            )}
          </SidebarMenu>
        </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="sidebar__footer">
          <div className="sidebar__workspace-card">
            <span className="sidebar__workspace-logo">
              <SidebarIcon name="brand" />
            </span>
            <span>
              <strong>{APP_NAME}</strong>
              <small>{recentChats.length} recent chats · native Postgres</small>
            </span>
          </div>
          <div className="sidebar-user-label">Demo User</div>
          {sidebarActionStatus ? (
            <div className="sidebar-action-status">{sidebarActionStatus}</div>
          ) : null}
        </SidebarFooter>
      </Sidebar>

      {sidebarMenu && typeof document !== "undefined" ? createPortal(
        <div
          className="chat-context-layer"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setSidebarMenu(null);
            }
          }}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              setSidebarMenu(null);
            }
          }}
          role="presentation"
        >
          <div
            className="chat-context-menu chat-context-menu--manual ui-context-menu__content"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            role="menu"
            style={{
              left: sidebarMenu.x,
              top: sidebarMenu.y
            }}
          >
            {getSidebarChatActions(sidebarMenu.chat).map((action) => (
              <button
                className={`ui-context-menu__item ${action.variant === "destructive" ? "ui-context-menu__item--destructive" : ""}`}
                disabled={isSidebarActionLoading}
                key={action.key}
                onClick={(event) => handleSidebarMenuActionClick(event, action)}
                onPointerDown={(event) => event.stopPropagation()}
                role="menuitem"
                type="button"
              >
                <span aria-hidden="true" className="chat-context-menu__icon">
                  {action.icon}
                </span>
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </div>,
        document.body
      ) : null}

      <Dialog
        open={Boolean(renamingChat)}
        onOpenChange={(open) => {
          if (!open) {
            setRenamingChat(null);
          }
        }}
      >
        <DialogContent className="sidebar-modal" showCloseButton={false}>
            <span className="sidebar-modal__eyebrow">Rename chat</span>
            <DialogTitle>Give this chat a clearer title</DialogTitle>
            <Input
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
              <Button
                className="secondary-button"
                disabled={isSidebarActionLoading}
                onClick={() => setRenamingChat(null)}
                type="button"
              >
                Cancel
              </Button>
              <Button
                className="primary-button primary-button--inline"
                disabled={isSidebarActionLoading || !renameDraft.trim()}
                onClick={() => {
                  void handleSaveRenameChat();
                }}
                type="button"
              >
                {isSidebarActionLoading ? "Saving..." : "Save"}
              </Button>
            </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isSearchOpen}
        onOpenChange={(open) => {
          setIsSearchOpen(open);

          if (open) {
            setSearchError(null);
          }
        }}
      >
        <DialogContent className="search-modal" showCloseButton={false}>
          <div className="search-modal__header">
            <div>
              <span className="sidebar-modal__eyebrow">Search</span>
              <DialogTitle>Search chats and memory</DialogTitle>
            </div>
            <Button
              aria-label="Close search"
              className="message-action-button"
              onClick={() => setIsSearchOpen(false)}
              title="Close search"
              type="button"
              variant="ghost"
            >
              <X aria-hidden="true" />
            </Button>
          </div>

          <div className="search-modal__form">
            <Input
              autoFocus
              className="search-modal__input"
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleSearchSubmit();
                }

                if (event.key === "Escape") {
                  setIsSearchOpen(false);
                }
              }}
              placeholder="Search messages, branches, summaries, files..."
              value={searchQuery}
            />
            <Button
              className="primary-button primary-button--inline"
              disabled={isSearchLoading || !searchQuery.trim()}
              onClick={() => void handleSearchSubmit()}
              type="button"
            >
              {isSearchLoading ? "Searching..." : "Search"}
            </Button>
          </div>

          {searchError ? <div className="search-modal__error">{searchError}</div> : null}

          <div className="search-modal__results">
            {searchResults.length === 0 ? (
              <p className="search-modal__empty">
                {searchQuery.trim()
                  ? "No results yet. Run a search to inspect chats, branches, messages, and artifacts."
                  : "Enter a term to search across conversations, paths, messages, memories, and attachments."}
              </p>
            ) : (
              searchResults.map((result) => (
                <button
                  className="search-result"
                  key={`${result.sourceType}:${result.sourceId}`}
                  onClick={() => void handleSelectSearchResult(result)}
                  type="button"
                >
                  <span className="search-result__type">
                    {formatSearchSourceType(result.sourceType)}
                  </span>
                  <strong>{result.title}</strong>
                  <span>{result.snippet}</span>
                  <small>{new Date(result.createdAt).toLocaleString()}</small>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(citationPreview)}
        onOpenChange={(open) => {
          if (!open) {
            setCitationPreview(null);
          }
        }}
      >
        <DialogContent className="citation-modal" showCloseButton={false}>
          {citationPreview ? (
            <>
              <div className="search-modal__header">
                <div>
                  <span className="sidebar-modal__eyebrow">
                    {getCitationSourceLabel(citationPreview.source)}
                  </span>
                  <DialogTitle>{citationPreview.source.label}</DialogTitle>
                </div>
                <Button
                  aria-label="Close source"
                  className="message-action-button"
                  onClick={() => setCitationPreview(null)}
                  title="Close source"
                  type="button"
                  variant="ghost"
                >
                  <X aria-hidden="true" />
                </Button>
              </div>

              <div className="citation-modal__body">
                <p>{citationPreview.source.snippet ?? "No preview text was recorded."}</p>
                <dl>
                  <div>
                    <dt>Source type</dt>
                    <dd>{getCitationOriginType(citationPreview.source).replace(/_/g, " ")}</dd>
                  </div>
                  <div>
                    <dt>Source ID</dt>
                    <dd>{citationPreview.source.sourceId}</dd>
                  </div>
                  {citationPreview.source.pathId ? (
                    <div>
                      <dt>Path ID</dt>
                      <dd>{citationPreview.source.pathId}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>

              <div className="sidebar-modal__actions">
                <Button
                  className="secondary-button"
                  onClick={() => setCitationPreview(null)}
                  type="button"
                >
                  Close
                </Button>
                <Button
                  className="primary-button primary-button--inline"
                  disabled={!citationPreview.source.pathId}
                  onClick={() => void handleOpenCitationSource(citationPreview.source)}
                  type="button"
                >
                  Open source
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deletingChat)}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingChat(null);
          }
        }}
      >
        <AlertDialogContent className="sidebar-modal sidebar-modal--danger">
          {deletingChat ? (
            <>
            <span className="sidebar-modal__eyebrow">Delete chat</span>
            <AlertDialogTitle>{`Delete "${deletingChat.title}"?`}</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the chat, branches, messages, merges, and share links.
            </AlertDialogDescription>
            <div className="sidebar-modal__actions">
              <Button
                className="secondary-button"
                disabled={isSidebarActionLoading}
                onClick={() => setDeletingChat(null)}
                type="button"
              >
                Cancel
              </Button>
              <Button
                className="primary-button primary-button--inline sidebar-modal__delete"
                disabled={isSidebarActionLoading}
                onClick={() => {
                  void handleConfirmDeleteChat();
                }}
                type="button"
              >
                {isSidebarActionLoading ? "Deleting..." : "Delete forever"}
              </Button>
            </div>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>

      <ImagePreviewDialog image={previewImage} onClose={() => setPreviewImage(null)} />

      <section className="workspace">
        <div className="workspace-top-actions" aria-label="Conversation actions">
          <Button
            className="workspace-action-button"
            disabled={!conversation || paths.length === 0}
            onClick={() => setIsGraphOverlayOpen(true)}
            title="Open graph"
            type="button"
          >
            <Network aria-hidden="true" />
            <span>Graph</span>
          </Button>

          {activePath?.isMain === false ? (
            <Button
              className="workspace-action-button workspace-action-button--merge"
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
              title="Merge to Main"
              type="button"
            >
              <GitMerge aria-hidden="true" />
              <span>{isMerging ? "Merging..." : "Merge"}</span>
            </Button>
          ) : null}
        </div>

        <div className="transcript" ref={transcriptRef}>
          {!conversation ? (
            <div className="hero-empty">
              <span className="hero-empty__badge">Start here</span>
              <h3 className="hero-empty__title">A cleaner AI chat, centered on reading</h3>
              <p className="hero-empty__copy">
                Create a new chat, ask your first question, and the title in the sidebar
                will adapt from your opening messages.
              </p>
              <Button
                className="primary-button primary-button--inline"
                disabled={isCreatingConversation}
                onClick={handleCreateConversation}
                type="button"
              >
                {isCreatingConversation ? "Creating..." : "Create new chat"}
              </Button>
            </div>
          ) : messages.length === 0 ? (
            <div className="hero-empty">
              <span className="hero-empty__badge">
                {activePath?.isMain === false ? "Branch" : "New chat"}
              </span>
              <h3 className="hero-empty__title">
                {activePath?.isMain === false
                  ? activeConversationTitle
                  : "Say what you need in your own words"}
              </h3>
              <p className="hero-empty__copy">
                {activePath?.isMain === false
                  ? "Continue this branch from its selected point in the conversation."
                  : "The interface stays light on chrome so long answers read like a page instead of a dashboard."}
              </p>

              {activePath?.isMain ? (
                <div className="quick-prompts">
                  {QUICK_PROMPTS.map((prompt) => (
                    <Button
                      className="quick-prompt-button"
                      key={prompt}
                      onClick={() => setActiveDraft(prompt)}
                      type="button"
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            messages.map((message, messageIndex) => {
              const isEditingUserMessage = editingMessageId === message.id;
              const isFailedAssistant = isFailedAssistantMessage(message);
              const messageResilience = getMessageResilience(message);
              const isStreamingAssistantMessage =
                message.role === "assistant" && isSending && messageIndex === messages.length - 1;
              const isBranchingEnabledForMessage =
                message.role === "assistant" &&
                !isStreamingAssistantMessage &&
                !isFailedAssistant &&
                message.contentText.trim().length > 0;
              const canEditUserMessage =
                message.role === "user" &&
                message.id === latestEditableUserMessageId &&
                !isSending &&
                !isSavingMessageEdit;

              return (
              <article
                className={`chat-message chat-message--${message.role}`}
                data-message-id={message.id}
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
                  message.messageType === "merge_memory" ? (
                    <MergeMemoryCard message={message} />
                  ) : (
                    <>
                      <div className="assistant-response">
                        {isFailedAssistant ? (
                          <div className="message-failure-banner">
                            <AlertTriangle aria-hidden="true" />
                            <div>
                              <strong>
                                {messageResilience?.partial
                                  ? "Response stopped early"
                                  : "Response failed"}
                              </strong>
                              <span>{getMessageFailureText(message)}</span>
                            </div>
                          </div>
                        ) : null}
                        <SmogGradeBadge content={message.contentText} />
                        <BranchableMarkdownContent
                          branchDraft={
                            branchDraft?.splitFromMessageId === message.id ? branchDraft : null
                          }
                          className="markdown-content markdown-content--message"
                          content={message.contentText || "..."}
                          isBranchingEnabled={isBranchingEnabledForMessage}
                          message={message}
                          onCopyBlock={(text) => {
                            void handleCopyMarkdownBlock(text);
                          }}
                          onOpenBranchDraft={handleOpenBranchDraft}
                        />
                        {message.messageType === "merge_memory" ||
                        getAssistantLineageSummary(message) ||
                        isFailedAssistant ? (
                          <div className="message-chip-row">
                            {message.messageType === "merge_memory" ? (
                              <span className="message-tag">Merged memory</span>
                            ) : null}
                            <AssistantLineageTag
                              message={message}
                              onSelectVariant={(variantNo) =>
                                void handleSelectAssistantVariant(message, variantNo)
                              }
                            />
                            {isFailedAssistant ? (
                              <span className="message-tag message-tag--failed">Failed</span>
                            ) : null}
                          </div>
                        ) : null}
                        <CitationSourceChips
                          message={message}
                          onInspect={(source) =>
                            setCitationPreview({
                              messageId: message.id,
                              source
                            })
                          }
                        />
                      </div>
                      <div className="message-actions message-actions--assistant">
                        <Button
                          aria-label="Redo response"
                          className="message-action-button"
                          disabled={isSending}
                          onClick={() => void handleRedoAssistantMessage(message)}
                          title="Redo response"
                          type="button"
                          variant="ghost"
                        >
                          <RefreshCcw aria-hidden="true" />
                        </Button>
                        {isFailedAssistant ? (
                          <>
                            <Button
                              aria-label="Copy error"
                              className="message-action-button"
                              onClick={() => void handleCopyMessageError(message)}
                              title="Copy error"
                              type="button"
                              variant="ghost"
                            >
                              <Copy aria-hidden="true" />
                            </Button>
                            <Button
                              aria-label="Inspect failed run"
                              className="message-action-button"
                              onClick={() => handleInspectFailedRun(message)}
                              title="Inspect failed run"
                              type="button"
                              variant="ghost"
                            >
                              <BookOpen aria-hidden="true" />
                            </Button>
                          </>
                        ) : null}
                        <Button
                          aria-label="Copy response"
                          className="message-action-button"
                          onClick={() => void handleCopyMessage(message, "Response copied.")}
                          title={copiedMessageId === message.id ? "Copied" : "Copy response"}
                          type="button"
                          variant="ghost"
                        >
                          <Copy aria-hidden="true" />
                        </Button>
                      </div>
                    </>
                  )
                ) : (
                  <>
                    {isEditingUserMessage ? (
                      <div className="chat-bubble chat-bubble--editing">
                        <Textarea
                          aria-label="Edit message"
                          className="chat-bubble-edit-input"
                          disabled={isSavingMessageEdit}
                          onChange={(event) => setEditingMessageDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              handleCancelUserMessageEdit();
                              return;
                            }

                            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                              event.preventDefault();
                              void handleSaveUserMessageEdit(message);
                            }
                          }}
                          ref={messageEditInputRef}
                          value={editingMessageDraft}
                        />
                        <div className="chat-bubble-edit-actions">
                          <Button
                            aria-label="Cancel edit"
                            className="message-action-button"
                            disabled={isSavingMessageEdit}
                            onClick={handleCancelUserMessageEdit}
                            title="Cancel edit"
                            type="button"
                            variant="ghost"
                          >
                            <X aria-hidden="true" />
                          </Button>
                          <Button
                            aria-label="Save edit"
                            className="message-action-button message-action-button--confirm"
                            disabled={isSavingMessageEdit || !editingMessageDraft.trim()}
                            onClick={() => void handleSaveUserMessageEdit(message)}
                            title="Save edit"
                            type="button"
                            variant="ghost"
                          >
                            <Check aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="chat-bubble">
                        <UserMessageContent
                          attachments={getMessageAttachments(message)}
                          content={message.contentText || "..."}
                          onOpenImage={setPreviewImage}
                        />
                      </div>
                    )}
                    {message.role === "user" && !isEditingUserMessage ? (
                      <div className="message-actions message-actions--user">
                        <Button
                          aria-label="Copy message"
                          className="message-action-button"
                          onClick={() => void handleCopyMessage(message, "Message copied.")}
                          title={copiedMessageId === message.id ? "Copied" : "Copy message"}
                          type="button"
                          variant="ghost"
                        >
                          <Copy aria-hidden="true" />
                        </Button>
                        {canEditUserMessage ? (
                          <Button
                            aria-label="Edit message"
                            className="message-action-button"
                            onClick={() => handleEditUserMessage(message)}
                            title="Edit message"
                            type="button"
                            variant="ghost"
                          >
                            <PencilLine aria-hidden="true" />
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                )}
              </article>
              );
            })
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
                <Button
                  className="secondary-button"
                  disabled={isMerging}
                  onClick={handleCancelMergeConfirmation}
                  type="button"
                >
                  Cancel
                </Button>
                <Button
                  className="primary-button primary-button--inline"
                  disabled={isMerging}
                  onClick={handleConfirmMerge}
                  type="button"
                >
                  {isMerging ? "Merging..." : "Merge into Main"}
                </Button>
              </div>
            </div>
          ) : null}

          {activePath?.isMain === false && !mergeConfirmation && mergeSuccessNotice ? (
            <div className="composer-merge-state composer-merge-state--success">
              <p>{`Merged from "${mergeSuccessNotice.sourcePathTitle}" into Main.`}</p>
              <div className="composer-merge-state__actions">
                <Button
                  className="primary-button primary-button--inline"
                  onClick={handleGoToMainPath}
                  type="button"
                >
                  {`Go to "${mergeSuccessNotice.targetPathTitle}"`}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="composer-row">
            <div className="composer">
              <div className="composer-plus-wrap" ref={composerMenuRef}>
                <Button
                  aria-expanded={isComposerMenuOpen}
                  aria-label="Open attachment menu"
                  className="composer-plus-button"
                  disabled={!conversation}
                  onClick={() => setIsComposerMenuOpen((current) => !current)}
                  type="button"
                >
                  <Plus aria-hidden="true" />
                </Button>

                {isComposerMenuOpen ? (
                  <div className="composer-attachment-menu" role="menu">
                    <button
                      className="composer-attachment-menu__item"
                      onClick={() => composerFileInputRef.current?.click()}
                      role="menuitem"
                      type="button"
                    >
                      <Paperclip aria-hidden="true" />
                      <span>Add files</span>
                    </button>
                    {isWebSearchAvailable ? (
                      <button
                        className={`composer-attachment-menu__item ${
                          isWebSearchEnabled ? "composer-attachment-menu__item--active" : ""
                        }`}
                        onClick={handleToggleWebSearch}
                        role="menuitem"
                        type="button"
                      >
                        <Globe2 aria-hidden="true" />
                        <span>{isWebSearchEnabled ? "Web search on" : "Web search"}</span>
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <input
                className="composer-file-input"
                multiple
                onChange={handleComposerFileChange}
                ref={composerFileInputRef}
                type="file"
              />

              {activeComposerAttachments.length > 0 || isWebSearchEnabled ? (
                <div className="composer-context-row">
                  {isWebSearchEnabled ? (
                    <span className="composer-context-chip composer-context-chip--web">
                      <Globe2 aria-hidden="true" />
                      <span>Web search</span>
                    </span>
                  ) : null}

                  {activeComposerAttachments.map((attachment) => (
                    <span className="composer-context-chip" key={attachment.id}>
                      {isImageAttachment(attachment) && attachment.dataUrl ? (
                        <button
                          aria-label={`View ${attachment.name}`}
                          className="composer-context-chip__preview"
                          onClick={() =>
                            setPreviewImage({
                              meta: `${attachment.mimeType || "unknown type"}, ${formatFileSize(attachment.size)}`,
                              name: attachment.name,
                              src: attachment.dataUrl ?? ""
                            })
                          }
                          type="button"
                        >
                          <img alt="" src={attachment.dataUrl} />
                          <span>{attachment.name}</span>
                        </button>
                      ) : (
                        <>
                          {isImageAttachment(attachment) ? (
                            <ImageIcon aria-hidden="true" />
                          ) : (
                            <FileText aria-hidden="true" />
                          )}
                          <span>{attachment.name}</span>
                        </>
                      )}
                      <small>{formatFileSize(attachment.size)}</small>
                      <button
                        aria-label={`Remove ${attachment.name}`}
                        onClick={() => {
                          if (activePathId) {
                            removeComposerAttachment(activePathId, attachment.id);
                          }
                        }}
                        type="button"
                      >
                        <X aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              {isLocalModelSelectorEnabled ? (
                <div className="composer-model-row" ref={composerModelRef}>
                  <button
                    aria-controls="composer-local-model-menu"
                    aria-expanded={isLocalModelMenuOpen}
                    aria-haspopup="listbox"
                    aria-label={
                      isHostedModelSelector ? "Choose hosted model" : "Choose local Gemma 4 model"
                    }
                    className="composer-model-trigger"
                    disabled={isLocalModelControlDisabled}
                    onClick={handleToggleLocalModelMenu}
                    type="button"
                  >
                    <span>{`${selectedLocalModelLabel} - ${selectedModelModeLabel}`}</span>
                    <ChevronDown aria-hidden="true" />
                  </button>

                  {isLocalModelMenuOpen ? (
                    <div
                      className="composer-model-popover"
                      id="composer-local-model-menu"
                      role="listbox"
                    >
                      <div className="composer-model-popover__title">{modelSelectorTitle}</div>
                      {localModels.flatMap((model) => {
                        const doesModelSupportThinking =
                          doesSelectedProviderSupportThinking &&
                          (model.supportsThinking ?? doesSelectedProviderSupportThinking);
                        const variants = [
                          {
                            description: "Answers quickly",
                            label: "Fast",
                            thinkingEnabled: false
                          },
                          ...(doesModelSupportThinking
                            ? [
                                {
                                  description: "Solves complex problems",
                                  label: "Thinking",
                                  thinkingEnabled: true
                                }
                              ]
                            : [])
                        ];

                        return variants.map((variant) => {
                          const isSelected =
                            model.name === selectedLocalModelName &&
                            variant.thinkingEnabled === selectedThinkingEnabled;

                          return (
                            <button
                              aria-selected={isSelected}
                              className="composer-model-option"
                              key={`${model.name}-${variant.label}`}
                              onClick={() =>
                                handleModelVariantChange(model.name, variant.thinkingEnabled)
                              }
                              role="option"
                              type="button"
                            >
                              <span>
                                <strong>{`${model.label} - ${variant.label}`}</strong>
                                <small>{variant.description}</small>
                                <small>{model.name}</small>
                              </span>
                              {isSelected ? <Check aria-hidden="true" /> : null}
                            </button>
                          );
                        });
                      })}
                    </div>
                  ) : null}

                  {localModelsError ? (
                    <span className="composer-model-status">{localModelsError}</span>
                  ) : null}
                </div>
              ) : null}

              <Textarea
                className="composer-input"
                disabled={!conversation}
                onChange={(event) => setActiveDraft(event.target.value)}
                onPaste={handleComposerPaste}
                placeholder={!conversation ? "Create a new chat to begin..." : "Ask anything..."}
                ref={composerInputRef}
                rows={1}
                value={draft}
              />
              <Button
                className={`composer-send ${isSending ? "composer-send--stop" : ""}`}
                disabled={isSending ? false : !canSend}
                onClick={isSending ? handleStopGenerating : handleSend}
                type="button"
                aria-label={isSending ? "Stop generating" : "Send message"}
                title={isSending ? "Stop generating" : "Send message"}
              >
                {isSending ? <StopGeneratingIcon /> : <SendIcon />}
              </Button>
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
                <Button
                  className="ops-overlay__close"
                  onClick={() => setIsOpsOverlayOpen(false)}
                  type="button"
                >
                  Close
                </Button>
              </div>

              <div className="ops-overlay__controls">
                <Label className="ops-control-field">
                  <span>Admin key</span>
                  <Input
                    onChange={(event) => setAdminApiKey(event.target.value)}
                    placeholder="Enter X-Admin-Key"
                    type="password"
                    value={adminApiKey}
                  />
                </Label>

                <Label className="ops-control-field">
                  <span>Run status</span>
                  <Select
                    onValueChange={(value) =>
                      setOpsStatusFilter(
                        value as
                          | "all"
                          | "completed"
                          | "failed"
                          | "queued"
                          | "started"
                      )
                    }
                    value={opsStatusFilter}
                  >
                    <SelectTrigger className="select-input">
                      <SelectValue placeholder="Run status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                      <SelectItem value="queued">Queued</SelectItem>
                      <SelectItem value="started">Started</SelectItem>
                    </SelectContent>
                  </Select>
                </Label>

                <Button
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
                </Button>
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
                    <strong>{`P50 ${opsSummary.latency.p50Ms}ms Â· P95 ${opsSummary.latency.p95Ms}ms`}</strong>
                    <small>{`${opsSummary.cache.hitRate}% explicit cache`}</small>
                  </article>
                </div>
              ) : null}

              <div className="ops-run-detail ops-path-context">
                <div className="ops-runs__header">
                  <span>Active path context</span>
                  <span>{isPathContextLoading ? "Loading" : activePathId ?? "No path"}</span>
                </div>
                {pathContextError ? (
                  <div className="ops-overlay__error">{pathContextError}</div>
                ) : null}
                {pathContextPreview ? (
                  <div className="ops-run-detail__grid">
                    <section>
                      <h3>Included</h3>
                      <div className="ops-inspect-item">
                        <strong>{`${pathContextPreview.recentMessages.length} recent messages`}</strong>
                        <span>{`${pathContextPreview.memories.mergeMemories.length} merge memories`}</span>
                        <small>
                          {pathContextPreview.memories.compaction ? "compaction active" : "no compaction"}
                        </small>
                      </div>
                    </section>
                    <section>
                      <h3>Retrieval</h3>
                      {pathContextPreview.retrievalCandidates.length === 0 ? (
                        <p>No retrieval candidates selected.</p>
                      ) : (
                        pathContextPreview.retrievalCandidates.map((candidate, index) => (
                          <div className="ops-inspect-item" key={`path-retrieval-${index}`}>
                            <strong>{getRecordString(candidate, "title") ?? "Candidate"}</strong>
                            <span>{getRecordString(candidate, "sourceType") ?? "unknown"}</span>
                            <small>{`score ${getRecordNumber(candidate, "score") ?? 0}`}</small>
                          </div>
                        ))
                      )}
                    </section>
                    <section>
                      <h3>Dropped</h3>
                      {getRecordArray(pathContextPreview.context, "droppedItems").length === 0 ? (
                        <p>No dropped items recorded.</p>
                      ) : (
                        getRecordArray(pathContextPreview.context, "droppedItems").map((item, index) => (
                          <div className="ops-inspect-item" key={`path-dropped-${index}`}>
                            <strong>{getRecordString(item, "kind") ?? "item"}</strong>
                            <span>{getRecordString(item, "reason") ?? "unknown"}</span>
                            <small>{`${getRecordNumber(item, "tokenEstimate") ?? 0} tokens`}</small>
                          </div>
                        ))
                      )}
                    </section>
                    <section>
                      <h3>Token plan</h3>
                      <div className="ops-inspect-item">
                        <strong>{`${pathContextPreview.context.estimatedTokens ?? 0} estimated tokens`}</strong>
                        <span>{`${getRecordArray(pathContextPreview.context, "cacheCandidates").length} cache candidates`}</span>
                        <small>{`${getRecordArray(pathContextPreview.context, "sources").length} sources`}</small>
                      </div>
                    </section>
                  </div>
                ) : (
                  <p className="ops-runs__empty">
                    {activePathId ? "Loading active path context..." : "Select a path to inspect context."}
                  </p>
                )}
              </div>

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
                      <article
                        className={`ops-run-row ${
                          selectedRunDetail?.run.id === run.id ? "ops-run-row--active" : ""
                        }`}
                        key={run.id}
                      >
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
                        <Button
                          className="ops-run-row__inspect"
                          disabled={isRunDetailLoading}
                          onClick={() => void handleInspectRun(run.id)}
                          type="button"
                        >
                          Inspect
                        </Button>
                      </article>
                    ))
                  )}
                </div>
              </div>

              {selectedRunDetail ? (
                <div className="ops-run-detail">
                  <div className="ops-runs__header">
                    <span>Run context</span>
                    <Button
                      className="ops-run-detail__close"
                      onClick={() => setSelectedRunDetail(null)}
                      type="button"
                    >
                      Close detail
                    </Button>
                  </div>
                  <div className="ops-run-detail__meta">
                    <span>{selectedRunDetail.run.id}</span>
                    <span>{selectedRunDetail.run.runType}</span>
                    <span>{selectedRunDetail.run.status}</span>
                    <span>{selectedRunDetail.run.latencyMs ?? 0}ms</span>
                  </div>

                  {(() => {
                    const context = selectedRunDetail.contextBundle;
                    const retrievalCandidates = getRecordArray(context, "retrievalCandidates");
                    const droppedItems = getRecordArray(context, "droppedItems");
                    const sources = getRecordArray(context, "sources");
                    const memories = getRecordArray(context, "memories");
                    const cacheCandidates = getRecordArray(context, "cacheCandidates");

                    return (
                      <div className="ops-run-detail__grid">
                        <section>
                          <h3>Sources</h3>
                          {sources.length === 0 ? (
                            <p>No source refs recorded.</p>
                          ) : (
                            sources.slice(0, 8).map((source, index) => (
                              <div className="ops-inspect-item" key={`source-${index}`}>
                                <strong>{getRecordString(source, "label") ?? "Source"}</strong>
                                <span>{getRecordString(source, "sourceType") ?? "unknown"}</span>
                                <small>{getRecordString(source, "sourceId") ?? "-"}</small>
                              </div>
                            ))
                          )}
                        </section>
                        <section>
                          <h3>Retrieval</h3>
                          {retrievalCandidates.length === 0 ? (
                            <p>No retrieval candidates selected.</p>
                          ) : (
                            retrievalCandidates.map((candidate, index) => (
                              <div className="ops-inspect-item" key={`retrieval-${index}`}>
                                <strong>{getRecordString(candidate, "title") ?? "Candidate"}</strong>
                                <span>{getRecordString(candidate, "sourceType") ?? "unknown"}</span>
                                <small>{`score ${getRecordNumber(candidate, "score") ?? 0}`}</small>
                              </div>
                            ))
                          )}
                        </section>
                        <section>
                          <h3>Dropped</h3>
                          {droppedItems.length === 0 ? (
                            <p>No dropped items recorded.</p>
                          ) : (
                            droppedItems.map((item, index) => (
                              <div className="ops-inspect-item" key={`dropped-${index}`}>
                                <strong>{getRecordString(item, "kind") ?? "item"}</strong>
                                <span>{getRecordString(item, "reason") ?? "unknown"}</span>
                                <small>{`${getRecordNumber(item, "tokenEstimate") ?? 0} tokens`}</small>
                              </div>
                            ))
                          )}
                        </section>
                        <section>
                          <h3>Memory + cache</h3>
                          <div className="ops-inspect-item">
                            <strong>{`${memories.length} memories`}</strong>
                            <span>{`${cacheCandidates.length} cache candidates`}</span>
                            <small>{`${isRecord(context) ? context.estimatedTokens ?? 0 : 0} estimated tokens`}</small>
                          </div>
                        </section>
                      </div>
                    );
                  })()}

                  <details className="ops-json-detail">
                    <summary>Raw payloads</summary>
                    <pre>{JSON.stringify(
                      {
                        requestPayload: selectedRunDetail.requestPayload,
                        responsePayload: selectedRunDetail.responsePayload
                      },
                      null,
                      2
                    )}</pre>
                  </details>
                </div>
              ) : null}
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

                <Button
                  className="graph-overlay__close"
                  onClick={() => setIsGraphOverlayOpen(false)}
                  type="button"
                >
                  Close
                </Button>
              </div>

              <div className="graph-overlay__body">
                <Suspense fallback={<BranchGraphLoading />}>
                  <BranchGraph
                    activePathId={activePathId}
                    conversationId={conversation?.id ?? null}
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

        {error ? (
          <ErrorToast
            error={error}
            onClose={() => setErrorState(null)}
            onCopyDetails={() => void handleCopyErrorDetails()}
          />
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
                <Button
                  className="branch-graph__modal-close"
                  onClick={() => setIsGraphDetailsOpen(false)}
                  type="button"
                >
                  Close
                </Button>
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
      </TooltipProvider>
    </SidebarProvider>
  );
};
