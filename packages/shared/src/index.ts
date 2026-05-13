export const APP_NAME = "Bonsai AI";
export const DEFAULT_API_HOST = "127.0.0.1";
export const DEFAULT_API_PORT = 4000;

export type PathType =
  | "chat"
  | "research"
  | "brainstorm"
  | "critique"
  | "planner"
  | "writer"
  | "merge";

export type SourceReferenceType =
  | "attachment"
  | "branch_snapshot"
  | "compacted_memory"
  | "merge_memory"
  | "message"
  | "retrieval_result"
  | "search_result";

export type SourceReference = {
  conversationId: string;
  label: string;
  metadata?: Record<string, unknown>;
  pathId: string | null;
  snippet?: string | null;
  sourceId: string;
  sourceType: SourceReferenceType;
};
