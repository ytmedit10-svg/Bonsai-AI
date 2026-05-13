export type GraphPath = {
  createdAt: string;
  depth: number;
  id: string;
  isMain: boolean;
  parentPathId: string | null;
  pathType: string;
  splitMessageCreatedAt: string | null;
  splitMessagePreview: string | null;
  splitMessageSequenceNo: number | null;
  title: string;
};

export type BranchGraphProps = {
  activePathId: string | null;
  conversationId?: string | null;
  mainTitle?: string;
  onSelectPath: (pathId: string) => void;
  paths: GraphPath[];
};

export type GraphTopology = {
  activeLineage: Set<string>;
  childrenByParentId: Map<string, GraphPath[]>;
  main: GraphPath;
  mainChildren: GraphPath[];
  sortedPaths: GraphPath[];
};
