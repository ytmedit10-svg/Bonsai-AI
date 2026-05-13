import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { BranchGraphProps, GraphPath, GraphTopology } from "./graph-types";
import { buildGraphTopology, normalizeTitle } from "./graph-utils";

type ThreadTreeItem = {
  childCount: number;
  children: ThreadTreeItem[];
  depth: number;
  isActive: boolean;
  isMain: boolean;
  isOnActiveLineage: boolean;
  label: string;
  path: GraphPath;
  title: string;
};

const MAX_INDENT_DEPTH = 4;

const getNodeDomId = (pathId: string) =>
  `mobile-thread-${pathId.replace(/[^A-Za-z0-9_-]/g, "-")}`;

const getNodeTitle = (
  path: GraphPath,
  mainTitle: string | undefined,
  isMain: boolean
) => {
  if (isMain) {
    return normalizeTitle(mainTitle?.trim() || path.title || "Main Chat");
  }

  return normalizeTitle(path.title || "Branch");
};

const getNodeLabel = (path: GraphPath, isMain: boolean) => {
  if (isMain) {
    return "Main";
  }

  return normalizeTitle(path.pathType || "Branch");
};

const buildThreadTreeItem = ({
  activePathId,
  depth,
  mainTitle,
  path,
  topology,
  visitedPathIds
}: {
  activePathId: string | null;
  depth: number;
  mainTitle?: string;
  path: GraphPath;
  topology: GraphTopology;
  visitedPathIds: Set<string>;
}): ThreadTreeItem => {
  const nextVisitedPathIds = new Set(visitedPathIds);

  nextVisitedPathIds.add(path.id);

  const children = (topology.childrenByParentId.get(path.id) ?? [])
    .filter((child) => !nextVisitedPathIds.has(child.id))
    .map((child) =>
      buildThreadTreeItem({
        activePathId,
        depth: depth + 1,
        mainTitle,
        path: child,
        topology,
        visitedPathIds: nextVisitedPathIds
      })
    );
  const isMain = path.id === topology.main.id;

  return {
    childCount: children.length,
    children,
    depth,
    isActive: path.id === activePathId,
    isMain,
    isOnActiveLineage: topology.activeLineage.has(path.id),
    label: getNodeLabel(path, isMain),
    path,
    title: getNodeTitle(path, mainTitle, isMain)
  };
};

const buildThreadTree = (
  topology: GraphTopology,
  activePathId: string | null,
  mainTitle?: string
) =>
  buildThreadTreeItem({
    activePathId,
    depth: 0,
    mainTitle,
    path: topology.main,
    topology,
    visitedPathIds: new Set()
  });

const getValidPathIds = (paths: GraphPath[]) =>
  new Set(paths.map((path) => path.id));

const hasSetChanged = (left: Set<string>, right: Set<string>) => {
  if (left.size !== right.size) {
    return true;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return true;
    }
  }

  return false;
};

const getCountLabel = (childCount: number) => {
  if (childCount === 0) {
    return "No child branches.";
  }

  return `${childCount} child ${childCount === 1 ? "branch" : "branches"}`;
};

type ThreadNodeProps = {
  expandedPathIds: Set<string>;
  item: ThreadTreeItem;
  onSelectPath: (pathId: string) => void;
  togglePathId: string | null;
};

const ThreadNode = ({
  expandedPathIds,
  item,
  onSelectPath,
  togglePathId
}: ThreadNodeProps) => {
  const hasChildren = item.children.length > 0;
  const isForcedOpen = item.isOnActiveLineage && item.path.id !== togglePathId;
  const isExpanded = hasChildren && (isForcedOpen || expandedPathIds.has(item.path.id));
  const childListId = `${getNodeDomId(item.path.id)}-children`;
  const cappedDepth = Math.min(item.depth, MAX_INDENT_DEPTH);

  return (
    <li
      className={[
        "mobile-graph__item",
        item.isMain ? "mobile-graph__item--main" : "",
        item.isActive ? "mobile-graph__item--active" : "",
        item.isOnActiveLineage ? "mobile-graph__item--lineage" : "",
        isExpanded ? "mobile-graph__item--expanded" : "",
        hasChildren ? "mobile-graph__item--has-children" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        {
          "--mobile-thread-depth": cappedDepth
        } as CSSProperties
      }
    >
      <div className="mobile-graph__row mobile-graph__row--leaf">
        <button
          aria-current={item.isActive ? "page" : undefined}
          className={[
            "mobile-graph__card",
            item.isMain ? "mobile-graph__card--main" : "",
            item.isActive ? "mobile-graph__card--active" : "",
            item.isOnActiveLineage ? "mobile-graph__card--lineage" : ""
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onSelectPath(item.path.id)}
          title={item.title}
          type="button"
        >
          <span>{item.label}</span>
          <strong>{item.title}</strong>
          <small>{getCountLabel(item.childCount)}</small>
        </button>
      </div>

      {hasChildren ? (
        <div
          className="mobile-graph__children-wrap"
          hidden={!isExpanded}
          id={childListId}
        >
          <ol className="mobile-graph__children">
            {item.children.map((child) => (
              <ThreadNode
                expandedPathIds={expandedPathIds}
                item={child}
                key={child.path.id}
                onSelectPath={onSelectPath}
                togglePathId={togglePathId}
              />
            ))}
          </ol>
        </div>
      ) : null}
    </li>
  );
};

const findSingleTogglePathId = (item: ThreadTreeItem): string | null => {
  const expandableActiveLineage = item.children.find((child) => {
    if (child.children.length === 0) {
      return false;
    }

    return child.isOnActiveLineage;
  });

  if (expandableActiveLineage) {
    return (
      findSingleTogglePathId(expandableActiveLineage) ??
      expandableActiveLineage.path.id
    );
  }

  if (item.children.length > 0 && !item.isMain) {
    return item.path.id;
  }

  const firstExpandableChild = item.children.find(
    (child) => child.children.length > 0
  );

  if (firstExpandableChild) {
    return findSingleTogglePathId(firstExpandableChild) ?? firstExpandableChild.path.id;
  }

  return item.children.length > 0 ? item.path.id : null;
};

const findThreadItem = (
  item: ThreadTreeItem,
  pathId: string
): ThreadTreeItem | null => {
  if (item.path.id === pathId) {
    return item;
  }

  for (const child of item.children) {
    const match = findThreadItem(child, pathId);

    if (match) {
      return match;
    }
  }

  return null;
};

export const MobileGraph = ({
  activePathId,
  mainTitle,
  onSelectPath,
  paths
}: BranchGraphProps) => {
  const topology = useMemo(
    () => buildGraphTopology(paths, activePathId),
    [activePathId, paths]
  );
  const tree = useMemo(
    () => (topology ? buildThreadTree(topology, activePathId, mainTitle) : null),
    [activePathId, mainTitle, topology]
  );
  const togglePathId = useMemo(
    () => (tree ? findSingleTogglePathId(tree) : null),
    [tree]
  );
  const toggleItem = useMemo(
    () => (tree && togglePathId ? findThreadItem(tree, togglePathId) : null),
    [togglePathId, tree]
  );
  const [expandedPathIds, setExpandedPathIds] = useState<Set<string>>(
    () => new Set()
  );

  useEffect(() => {
    if (!topology) {
      setExpandedPathIds(new Set());
      return;
    }

    setExpandedPathIds((current) => {
      const validPathIds = getValidPathIds(topology.sortedPaths);
      const next = new Set(
        [...current].filter((pathId) => validPathIds.has(pathId))
      );

      next.add(topology.main.id);
      topology.activeLineage.forEach((pathId) => next.add(pathId));

      return hasSetChanged(current, next) ? next : current;
    });
  }, [topology]);

  const handleTogglePath = (pathId: string) => {
    setExpandedPathIds((current) => {
      const next = new Set(current);

      if (next.has(pathId)) {
        next.delete(pathId);
      } else {
        next.add(pathId);
      }

      return next;
    });
  };

  if (!topology || !tree) {
    return (
      <section className="mobile-graph mobile-graph--empty" aria-label="Branch graph">
        <p className="mobile-graph__empty-text">No paths to display</p>
      </section>
    );
  }

  return (
    <section className="mobile-graph" aria-label="Conversation thread tree">
      <div className="mobile-graph__viewport">
        {toggleItem ? (
          <button
            aria-controls={`${getNodeDomId(toggleItem.path.id)}-children`}
            aria-expanded={expandedPathIds.has(toggleItem.path.id)}
            aria-label={`${
              expandedPathIds.has(toggleItem.path.id) ? "Collapse" : "Expand"
            } ${toggleItem.title}`}
            className="mobile-graph__toggle mobile-graph__tree-control"
            onClick={() => handleTogglePath(toggleItem.path.id)}
            type="button"
          >
            <span aria-hidden="true">
              {expandedPathIds.has(toggleItem.path.id) ? "-" : "+"}
            </span>
          </button>
        ) : null}
        <ol className="mobile-graph__tree">
          <ThreadNode
            expandedPathIds={expandedPathIds}
            item={tree}
            onSelectPath={onSelectPath}
            togglePathId={togglePathId}
          />
        </ol>
      </div>
    </section>
  );
};
