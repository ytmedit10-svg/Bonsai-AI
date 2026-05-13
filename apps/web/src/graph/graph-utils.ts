import type { GraphPath, GraphTopology } from "./graph-types";

export const normalizeTitle = (title: string) => title.replace(/\s+/g, " ").trim();

export const truncateTitle = (title: string, maxLength: number) => {
  const normalized = normalizeTitle(title);

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
};

export const sortByCreatedAt = (paths: GraphPath[]) =>
  [...paths].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  );

export const getMainPath = (paths: GraphPath[]) => {
  const sortedPaths = sortByCreatedAt(paths);

  return (
    sortedPaths.find((path) => path.isMain) ??
    sortedPaths.find((path) => !path.parentPathId) ??
    sortedPaths[0] ??
    null
  );
};

export const getChildrenByParentId = (paths: GraphPath[]) => {
  const childrenByParentId = new Map<string, GraphPath[]>();

  for (const path of paths) {
    if (!path.parentPathId) {
      continue;
    }

    const siblings = childrenByParentId.get(path.parentPathId) ?? [];
    siblings.push(path);
    childrenByParentId.set(path.parentPathId, siblings);
  }

  for (const [parentId, children] of childrenByParentId) {
    childrenByParentId.set(parentId, sortByCreatedAt(children));
  }

  return childrenByParentId;
};

export const getActiveLineage = (activePathId: string | null, paths: GraphPath[]) => {
  const lineage = new Set<string>();
  const pathMap = new Map(paths.map((path) => [path.id, path]));
  let current = activePathId ? pathMap.get(activePathId) ?? null : null;

  while (current) {
    lineage.add(current.id);
    current = current.parentPathId ? pathMap.get(current.parentPathId) ?? null : null;
  }

  return lineage;
};

const getPathAnchorOrder = (path: GraphPath, fallbackIndex: number) => {
  if (typeof path.splitMessageSequenceNo === "number") {
    return {
      key: `sequence:${path.splitMessageSequenceNo}`,
      sortValue: path.splitMessageSequenceNo
    };
  }

  return {
    key: `fallback:${path.id}`,
    sortValue: Number.MAX_SAFE_INTEGER - 100_000 + fallbackIndex
  };
};

export const getSiblingAnchorOrders = (siblings: GraphPath[]) => {
  const ordersByKey = new Map<string, { key: string; sortValue: number }>();

  siblings.forEach((sibling, siblingIndex) => {
    const order = getPathAnchorOrder(sibling, siblingIndex);

    if (!ordersByKey.has(order.key)) {
      ordersByKey.set(order.key, order);
    }
  });

  return [...ordersByKey.values()].sort((left, right) => {
    if (left.sortValue !== right.sortValue) {
      return left.sortValue - right.sortValue;
    }

    return left.key.localeCompare(right.key);
  });
};

export const getSiblingAnchorIndex = (siblings: GraphPath[], path: GraphPath) => {
  const anchorOrders = getSiblingAnchorOrders(siblings);
  const pathOrder = getPathAnchorOrder(path, Math.max(0, siblings.indexOf(path)));

  return Math.max(
    0,
    anchorOrders.findIndex((order) => order.key === pathOrder.key)
  );
};

export const getSiblingAnchorCount = (siblings: GraphPath[]) =>
  getSiblingAnchorOrders(siblings).length;

export const getGroupedMainAnchors = (
  mainChildren: GraphPath[],
  activeLineage: Set<string>
) =>
  getSiblingAnchorOrders(mainChildren).map((order, anchorIndex) => ({
    anchorIndex,
    id: `main-anchor-${order.key}`,
    isActiveLineage: mainChildren.some(
      (child, childIndex) =>
        getPathAnchorOrder(child, childIndex).key === order.key &&
        activeLineage.has(child.id)
    )
  }));

export const buildGraphTopology = (
  paths: GraphPath[],
  activePathId: string | null
): GraphTopology | null => {
  const sortedPaths = sortByCreatedAt(paths);
  const main = getMainPath(paths);

  if (!main) {
    return null;
  }

  const childrenByParentId = getChildrenByParentId(sortedPaths);

  return {
    activeLineage: getActiveLineage(activePathId, sortedPaths),
    childrenByParentId,
    main,
    mainChildren: childrenByParentId.get(main.id) ?? [],
    sortedPaths
  };
};
