import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent
} from "react";

type GraphPath = {
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

type BranchGraphProps = {
  activePathId: string | null;
  mainTitle?: string;
  onSelectPath: (pathId: string) => void;
  paths: GraphPath[];
};

type Point = {
  x: number;
  y: number;
};

type Route = {
  anchor: Point;
  childCount: number;
  controlA: Point;
  controlB: Point;
  end: Point;
  outlet: Point;
  path: GraphPath;
  side: 1 | -1;
};

type LayoutRoute = Route & {
  d: string;
  isActive: boolean;
  isOnActiveLineage: boolean;
  lane?: number;
  label: Point;
  preview: string;
  title: string;
};

type Layout = {
  activeLineage: Set<string>;
  branchRoutes: LayoutRoute[];
  height: number;
  main: GraphPath;
  mainBranchAnchors: Array<{
    id: string;
    isActiveLineage: boolean;
    point: Point;
  }>;
  mainEnd: Point;
  mainLabel: Point;
  mainNode: Point;
  mainStart: Point;
  width: number;
};

type ViewportTransform = {
  scale: number;
  x: number;
  y: number;
};

type GraphOrientation = "horizontal" | "vertical";

type GraphTopology = {
  activeLineage: Set<string>;
  childrenByParentId: Map<string, GraphPath[]>;
  main: GraphPath;
  mainChildren: GraphPath[];
  sortedPaths: GraphPath[];
};

type PanSession = {
  hasMoved: boolean;
  lastX: number;
  lastY: number;
  pointerId: number;
  totalDistance: number;
};

type NodeDragSession = {
  hasMoved: boolean;
  lastX: number;
  lastY: number;
  pathId: string;
  pointerId: number;
  startPosition: Point;
  totalDistance: number;
};

type TouchPoint = {
  clientX: number;
  clientY: number;
};

type PinchSession = {
  center: TouchPoint;
  distance: number;
  hasMoved: boolean;
};

const MIN_CANVAS_HEIGHT = 620;
const MIN_CANVAS_WIDTH = 1320;
const PADDING = 112;
const MAINLINE_Y = 360;
const MAIN_START_X = 150;
const MAIN_CARD_WIDTH = 206;
const MAIN_CARD_LINE_GAP = 0;
const BRANCH_CARD_WIDTH = 248;
const MAIN_END_PADDING = 340;
const MAIN_ANCHOR_SPACING = 230;
const MAIN_MIN_LENGTH = 1060;
const BRANCH_LENGTH = 300;
const BRANCH_DEPTH_LENGTH = 70;
const BRANCH_BASE_OFFSET = 150;
const BRANCH_PAIR_OFFSET = 82;
const BRANCH_DEPTH_OFFSET = 58;
const MOBILE_CARD_WIDTH = 176;
const MOBILE_MAIN_CARD_WIDTH = 170;
const MOBILE_NODE_GAP_Y = 148;
const MOBILE_LANE_GAP_X = 126;
const MOBILE_PADDING_X = 44;
const MOBILE_PADDING_Y = 56;
const MOBILE_CONNECTOR_GUTTER = 18;
const MOBILE_MAX_VISIBLE_SIDE_LANES = 2;
const MOBILE_MIN_CANVAS_HEIGHT = 960;
const MOBILE_MIN_CANVAS_WIDTH = 560;
const MOBILE_MAIN_CARD_HEIGHT = 72;
const MOBILE_BRANCH_CARD_HEIGHT = 76;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.25;
const FIT_PADDING = 88;
const MOBILE_FIT_PADDING = 28;
const CLICK_DRAG_THRESHOLD = 6;
const PHONE_MEDIA_QUERY = "(max-width: 720px)";
const ZOOM_STEP = 1.18;
const NODE_POSITION_STORAGE_PREFIX = "node-based-chat.branch-graph.positions";
const VIEWPORT_STORAGE_PREFIX = "node-based-chat.branch-graph.viewport";
const DEFAULT_VIEWPORT: ViewportTransform = {
  scale: 1,
  x: 0,
  y: 0
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const normalizeTitle = (title: string) => title.replace(/\s+/g, " ").trim();

const truncateTitle = (title: string, maxLength: number) => {
  const normalized = normalizeTitle(title);

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
};

const sortByCreatedAt = (paths: GraphPath[]) =>
  [...paths].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  );

const getMainPath = (paths: GraphPath[]) => {
  const sortedPaths = sortByCreatedAt(paths);

  return (
    sortedPaths.find((path) => path.isMain) ??
    sortedPaths.find((path) => !path.parentPathId) ??
    sortedPaths[0] ??
    null
  );
};

const getTouchGesture = (points: Iterable<TouchPoint>): PinchSession | null => {
  const [first, second] = [...points];

  if (!first || !second) {
    return null;
  }

  return {
    center: {
      clientX: (first.clientX + second.clientX) / 2,
      clientY: (first.clientY + second.clientY) / 2
    },
    distance: Math.max(
      1,
      Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)
    ),
    hasMoved: false
  };
};

const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const handleChange = () => setMatches(mediaQuery.matches);

    handleChange();
    mediaQuery.addEventListener("change", handleChange);

    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
};

const isPointRecord = (value: unknown): value is Record<string, Point> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(
    (point) =>
      Boolean(point) &&
      typeof point === "object" &&
      !Array.isArray(point) &&
      typeof (point as Point).x === "number" &&
      typeof (point as Point).y === "number"
  );
};

const readStoredNodePositions = (
  storageKey: string,
  validPathIds: Set<string>
): Record<string, Point> => {
  try {
    const rawValue = window.localStorage.getItem(storageKey);

    if (!rawValue) {
      return {};
    }

    const parsed = JSON.parse(rawValue) as unknown;

    if (!isPointRecord(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(([pathId]) => validPathIds.has(pathId))
    );
  } catch {
    return {};
  }
};

const writeStoredNodePositions = (
  storageKey: string,
  positions: Record<string, Point>
) => {
  try {
    if (Object.keys(positions).length === 0) {
      window.localStorage.removeItem(storageKey);
      return;
    }

    window.localStorage.setItem(storageKey, JSON.stringify(positions));
  } catch {
    // localStorage can fail in private mode or when quota is exceeded.
  }
};

const isViewportTransform = (value: unknown): value is ViewportTransform => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const viewport = value as ViewportTransform;

  return (
    Number.isFinite(viewport.scale) &&
    Number.isFinite(viewport.x) &&
    Number.isFinite(viewport.y)
  );
};

const readStoredViewport = (storageKey: string): ViewportTransform | null => {
  try {
    const rawValue = window.localStorage.getItem(storageKey);

    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as unknown;

    if (!isViewportTransform(parsed)) {
      return null;
    }

    return {
      scale: clamp(parsed.scale, MIN_ZOOM, MAX_ZOOM),
      x: parsed.x,
      y: parsed.y
    };
  } catch {
    return null;
  }
};

const writeStoredViewport = (
  storageKey: string,
  viewport: ViewportTransform
) => {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(viewport));
  } catch {
    // localStorage can fail in private mode or when quota is exceeded.
  }
};

const getChildrenByParentId = (paths: GraphPath[]) => {
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

const getActiveLineage = (activePathId: string | null, paths: GraphPath[]) => {
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

const getSiblingAnchorOrders = (siblings: GraphPath[]) => {
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

const getSiblingAnchorIndex = (siblings: GraphPath[], path: GraphPath) => {
  const anchorOrders = getSiblingAnchorOrders(siblings);
  const pathOrder = getPathAnchorOrder(path, Math.max(0, siblings.indexOf(path)));

  return Math.max(
    0,
    anchorOrders.findIndex((order) => order.key === pathOrder.key)
  );
};

const getGroupedMainAnchors = (
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

const getSiblingAnchorCount = (siblings: GraphPath[]) =>
  getSiblingAnchorOrders(siblings).length;

const createCurvePath = (route: Route) =>
  [
    `M ${route.anchor.x} ${route.anchor.y}`,
    `C ${route.controlA.x} ${route.controlA.y}`,
    `${route.controlB.x} ${route.controlB.y}`,
    `${route.end.x} ${route.end.y}`
  ].join(" ");

const createRoute = ({
  anchor,
  depth,
  endOverride,
  parentSide,
  path,
  siblingIndex,
  childCount
}: {
  anchor: Point;
  depth: number;
  endOverride?: Point;
  parentSide: 1 | -1 | null;
  path: GraphPath;
  siblingIndex: number;
  childCount: number;
}) => {
  const defaultSide: 1 | -1 = parentSide ?? (siblingIndex % 2 === 0 ? -1 : 1);
  const side: 1 | -1 =
    endOverride && Math.abs(endOverride.y - anchor.y) > 4
      ? endOverride.y > anchor.y
        ? 1
        : -1
      : defaultSide;
  const pairIndex = Math.floor(siblingIndex / 2);
  const verticalOffset =
    side *
    (BRANCH_BASE_OFFSET +
      pairIndex * BRANCH_PAIR_OFFSET +
      (parentSide ? BRANCH_DEPTH_OFFSET : depth * BRANCH_DEPTH_OFFSET));
  const horizontalLength = BRANCH_LENGTH + depth * BRANCH_DEPTH_LENGTH + pairIndex * 34;
  const end =
    endOverride ?? {
      x: anchor.x + horizontalLength,
      y: anchor.y + verticalOffset
    };
  const outlet = {
    x: end.x + BRANCH_CARD_WIDTH,
    y: end.y
  };
  const actualHorizontalLength = end.x - anchor.x;
  const actualVerticalOffset = end.y - anchor.y;
  const controlLift = actualVerticalOffset * 0.72;

  return {
    anchor,
    childCount,
    controlA: {
      x: anchor.x + actualHorizontalLength * 0.23,
      y: anchor.y
    },
    controlB: {
      x: anchor.x + actualHorizontalLength * 0.54,
      y: anchor.y + controlLift
    },
    end,
    outlet,
    path,
    side
  };
};

const shiftPoint = (point: Point, offset: Point): Point => ({
  x: point.x + offset.x,
  y: point.y + offset.y
});

const shiftRoute = (route: LayoutRoute, offset: Point): LayoutRoute => {
  const shiftedRoute = {
    ...route,
    anchor: shiftPoint(route.anchor, offset),
    controlA: shiftPoint(route.controlA, offset),
    controlB: shiftPoint(route.controlB, offset),
    end: shiftPoint(route.end, offset),
    outlet: shiftPoint(route.outlet, offset),
    label: shiftPoint(route.label, offset)
  };

  return {
    ...shiftedRoute,
    d: createCurvePath(shiftedRoute)
  };
};

const buildGraphTopology = (
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

const buildDesktopGraphLayout = (
  topology: GraphTopology,
  activePathId: string | null,
  nodePositionOverrides: Record<string, Point>
): Layout => {
  const { activeLineage, childrenByParentId, main, mainChildren } = topology;
  const rawBranchRoutes: Route[] = [];
  const rawRouteByPathId = new Map<string, Route>();
  const mainAnchorCount = Math.max(4, getSiblingAnchorCount(mainChildren) + 1);
  const mainNode = {
    x: MAIN_START_X,
    y: MAINLINE_Y
  };
  const mainAxisStart = {
    x: MAIN_START_X + MAIN_CARD_WIDTH + MAIN_CARD_LINE_GAP,
    y: MAINLINE_Y
  };
  const mainEnd = {
    x: Math.max(
      mainAxisStart.x + MAIN_MIN_LENGTH,
      mainAxisStart.x + mainAnchorCount * MAIN_ANCHOR_SPACING + MAIN_END_PADDING
    ),
    y: MAINLINE_Y
  };

  const visitChildren = (parent: GraphPath, depth: number) => {
    const siblings = childrenByParentId.get(parent.id) ?? [];
    const parentRoute = rawRouteByPathId.get(parent.id) ?? null;

    siblings.forEach((child, siblingIndex) => {
      const anchorIndex = getSiblingAnchorIndex(siblings, child);
      const anchor = parent.isMain
        ? {
            x: mainAxisStart.x + (anchorIndex + 1) * MAIN_ANCHOR_SPACING,
            y: MAINLINE_Y
          }
        : parentRoute
          ? parentRoute.outlet
          : {
              x: MAIN_START_X + (anchorIndex + 1) * MAIN_ANCHOR_SPACING,
              y: MAINLINE_Y
            };
      const route = createRoute({
        anchor,
        childCount: childrenByParentId.get(child.id)?.length ?? 0,
        depth,
        parentSide: parentRoute?.side ?? null,
        path: child,
        siblingIndex
      });

      rawBranchRoutes.push(route);
      rawRouteByPathId.set(child.id, route);
      visitChildren(child, depth + 1);
    });
  };

  visitChildren(main, 1);

  const rawPoints = [
    mainNode,
    mainAxisStart,
    mainEnd,
    ...rawBranchRoutes.flatMap((route) => [
      route.anchor,
      route.controlA,
      route.controlB,
      route.end,
      route.outlet,
      {
        x: route.outlet.x + 72,
        y: route.end.y + route.side * 50
      }
    ])
  ];
  const minX = Math.min(...rawPoints.map((point) => point.x));
  const minY = Math.min(...rawPoints.map((point) => point.y));
  const offset = {
    x: PADDING - minX,
    y: PADDING - minY
  };
  const offsetPoint = (point: Point) => ({
    x: point.x + offset.x,
    y: point.y + offset.y
  });
  const shiftedMainAxisStart = offsetPoint(mainAxisStart);
  const shiftedMainNode = offsetPoint(mainNode);
  const shiftedRoutes: Route[] = [];
  const shiftedRouteByPathId = new Map<string, Route>();

  const visitShiftedChildren = (parent: GraphPath, depth: number) => {
    const siblings = childrenByParentId.get(parent.id) ?? [];
    const parentRoute = shiftedRouteByPathId.get(parent.id) ?? null;

    siblings.forEach((child, siblingIndex) => {
      const anchorIndex = getSiblingAnchorIndex(siblings, child);
      const anchor = parent.isMain
        ? {
            x: shiftedMainAxisStart.x + (anchorIndex + 1) * MAIN_ANCHOR_SPACING,
            y: shiftedMainAxisStart.y
          }
        : parentRoute
          ? parentRoute.outlet
          : {
              x: shiftedMainNode.x + (anchorIndex + 1) * MAIN_ANCHOR_SPACING,
              y: shiftedMainNode.y
            };
      const route = createRoute({
        anchor,
        childCount: childrenByParentId.get(child.id)?.length ?? 0,
        depth,
        endOverride: nodePositionOverrides[child.id],
        parentSide: parentRoute?.side ?? null,
        path: child,
        siblingIndex
      });

      shiftedRoutes.push(route);
      shiftedRouteByPathId.set(child.id, route);
      visitShiftedChildren(child, depth + 1);
    });
  };

  visitShiftedChildren(main, 1);

  const layoutRoutes = shiftedRoutes.map((route) => ({
    ...route,
    d: createCurvePath(route),
    isActive: route.path.id === activePathId,
    isOnActiveLineage: activeLineage.has(route.path.id),
    label: {
      x: route.end.x,
      y: route.end.y
    },
    preview: route.path.splitMessagePreview ?? "Branch split point",
    title: truncateTitle(route.path.title, 54)
  }));
  const shiftedBoundsPoints = [
    shiftedMainNode,
    shiftedMainAxisStart,
    offsetPoint(mainEnd),
    ...shiftedRoutes.flatMap((route) => [
      route.anchor,
      route.controlA,
      route.controlB,
      route.end,
      route.outlet,
      {
        x: route.outlet.x + 72,
        y: route.end.y + route.side * 80
      }
    ])
  ];
  const shiftedMaxX = Math.max(...shiftedBoundsPoints.map((point) => point.x));
  const shiftedMaxY = Math.max(...shiftedBoundsPoints.map((point) => point.y));

  return {
    activeLineage,
    branchRoutes: layoutRoutes,
    height: Math.max(MIN_CANVAS_HEIGHT, shiftedMaxY + PADDING),
    main,
    mainBranchAnchors: getGroupedMainAnchors(mainChildren, activeLineage).map(
      (anchor) => ({
        id: anchor.id,
        isActiveLineage: anchor.isActiveLineage,
        point: offsetPoint({
          x: mainAxisStart.x + (anchor.anchorIndex + 1) * MAIN_ANCHOR_SPACING,
          y: MAINLINE_Y
        })
      })
    ),
    mainEnd: offsetPoint(mainEnd),
    mainLabel: offsetPoint(mainNode),
    mainNode: shiftedMainNode,
    mainStart: shiftedMainAxisStart,
    width: Math.max(MIN_CANVAS_WIDTH, shiftedMaxX + PADDING)
  };
};

const getMobileMainChildLane = (siblingIndex: number) => {
  const laneNumber = Math.floor(siblingIndex / 2) + 1;
  const side = siblingIndex % 2 === 0 ? 1 : -1;

  return laneNumber * side;
};

const getMobileChildLane = (parentLane: number, siblingIndex: number) => {
  const side = parentLane < 0 ? -1 : 1;

  return parentLane + side * (siblingIndex + 1);
};

const createMobileRoutePath = (route: Route) => {
  const direction = route.side;
  const xDistance = Math.abs(route.end.x - route.anchor.x);
  const yDistance = Math.abs(route.end.y - route.anchor.y);
  const horizontalControl = Math.max(
    MOBILE_CONNECTOR_GUTTER * 2,
    Math.min(96, xDistance * 0.52)
  );
  const verticalControl = Math.max(34, Math.min(96, yDistance * 0.55));

  return [
    `M ${route.anchor.x} ${route.anchor.y}`,
    `C ${route.anchor.x + direction * horizontalControl} ${route.anchor.y}`,
    `${route.end.x - direction * MOBILE_CONNECTOR_GUTTER} ${route.end.y - verticalControl}`,
    `${route.end.x} ${route.end.y}`
  ].join(" ");
};

const buildMobileLaneGraphLayout = (
  topology: GraphTopology,
  activePathId: string | null
): Layout => {
  const { activeLineage, childrenByParentId, main, mainChildren } = topology;
  const spineX =
    MOBILE_PADDING_X +
    MOBILE_MAX_VISIBLE_SIDE_LANES * MOBILE_LANE_GAP_X +
    MOBILE_CARD_WIDTH / 2;
  const mainY = MOBILE_PADDING_Y + MOBILE_MAIN_CARD_HEIGHT / 2;
  const mainAxisStart = {
    x: spineX,
    y: mainY + MOBILE_MAIN_CARD_HEIGHT / 2 + MOBILE_CONNECTOR_GUTTER
  };
  const laneNextY = new Map<number, number>();
  const routeByPathId = new Map<string, LayoutRoute>();
  const branchRoutes: LayoutRoute[] = [];
  const mainAnchorOrders = getGroupedMainAnchors(mainChildren, activeLineage);
  const mainAnchorYByIndex = new Map(
    mainAnchorOrders.map((anchor, index) => [
      anchor.anchorIndex,
      mainAxisStart.y + (index + 1) * MOBILE_NODE_GAP_Y
    ])
  );
  let maxY = mainAxisStart.y;

  const reserveLaneY = (lane: number, preferredY: number) => {
    const nextY = laneNextY.get(lane) ?? preferredY;
    const y = Math.max(preferredY, nextY);

    laneNextY.set(lane, y + MOBILE_NODE_GAP_Y);
    maxY = Math.max(maxY, y + MOBILE_BRANCH_CARD_HEIGHT);

    return y;
  };

  const createLaneRoute = ({
    anchor,
    lane,
    path,
    preferredY
  }: {
    anchor: Point;
    lane: number;
    path: GraphPath;
    preferredY: number;
  }): LayoutRoute => {
    const side: 1 | -1 = lane < 0 ? -1 : 1;
    const laneX = spineX + lane * MOBILE_LANE_GAP_X;
    const cardY = reserveLaneY(lane, preferredY);
    const labelX =
      lane < 0
        ? laneX - MOBILE_CARD_WIDTH - MOBILE_CONNECTOR_GUTTER
        : laneX + MOBILE_CONNECTOR_GUTTER;
    const end = {
      x: lane < 0 ? labelX + MOBILE_CARD_WIDTH : labelX,
      y: cardY
    };
    const route: Route = {
      anchor,
      childCount: childrenByParentId.get(path.id)?.length ?? 0,
      controlA: anchor,
      controlB: end,
      end,
      outlet: {
        x: end.x,
        y: end.y + MOBILE_BRANCH_CARD_HEIGHT / 2 + MOBILE_CONNECTOR_GUTTER
      },
      path,
      side
    };

    return {
      ...route,
      d: createMobileRoutePath(route),
      isActive: path.id === activePathId,
      isOnActiveLineage: activeLineage.has(path.id),
      label: {
        x: labelX,
        y: cardY
      },
      lane,
      preview: path.splitMessagePreview ?? "Branch split point",
      title: truncateTitle(path.title, 42)
    };
  };

  const visitChildren = (parent: GraphPath, parentLane: number) => {
    const siblings = childrenByParentId.get(parent.id) ?? [];
    const parentRoute = routeByPathId.get(parent.id) ?? null;

    siblings.forEach((child, siblingIndex) => {
      const lane = parent.isMain
        ? getMobileMainChildLane(siblingIndex)
        : getMobileChildLane(parentLane, siblingIndex);
      const anchorIndex = getSiblingAnchorIndex(siblings, child);
      const parentAnchor = parent.isMain
        ? {
            x: spineX,
            y:
              mainAnchorYByIndex.get(anchorIndex) ??
              mainAxisStart.y + (anchorIndex + 1) * MOBILE_NODE_GAP_Y
          }
        : parentRoute
          ? parentRoute.outlet
          : {
              x: spineX,
              y: mainAxisStart.y + (anchorIndex + 1) * MOBILE_NODE_GAP_Y
            };
      const route = createLaneRoute({
        anchor: parentAnchor,
        lane,
        path: child,
        preferredY: parentAnchor.y + MOBILE_NODE_GAP_Y * 0.58
      });

      branchRoutes.push(route);
      routeByPathId.set(child.id, route);
      visitChildren(child, lane);
    });
  };

  visitChildren(main, 0);

  const mainBranchAnchors = mainAnchorOrders.map((anchor) => ({
    id: anchor.id,
    isActiveLineage: anchor.isActiveLineage,
    point: {
      x: spineX,
      y:
        mainAnchorYByIndex.get(anchor.anchorIndex) ??
        mainAxisStart.y + (anchor.anchorIndex + 1) * MOBILE_NODE_GAP_Y
    }
  }));
  const mainEndY = Math.max(
    mainAxisStart.y + MOBILE_NODE_GAP_Y,
    maxY + MOBILE_NODE_GAP_Y * 0.35,
    ...mainBranchAnchors.map((anchor) => anchor.point.y + MOBILE_NODE_GAP_Y * 0.35)
  );
  const mainLayout: Layout = {
    activeLineage,
    branchRoutes,
    height: MOBILE_MIN_CANVAS_HEIGHT,
    main,
    mainBranchAnchors,
    mainEnd: {
      x: spineX,
      y: mainEndY
    },
    mainLabel: {
      x: spineX - MOBILE_MAIN_CARD_WIDTH / 2,
      y: mainY
    },
    mainNode: {
      x: spineX,
      y: mainY
    },
    mainStart: mainAxisStart,
    width: MOBILE_MIN_CANVAS_WIDTH
  };
  const boundsPoints = [
    {
      x: mainLayout.mainLabel.x,
      y: mainLayout.mainLabel.y - MOBILE_MAIN_CARD_HEIGHT / 2
    },
    {
      x: mainLayout.mainLabel.x + MOBILE_MAIN_CARD_WIDTH,
      y: mainLayout.mainLabel.y + MOBILE_MAIN_CARD_HEIGHT / 2
    },
    mainLayout.mainStart,
    mainLayout.mainEnd,
    ...mainBranchAnchors.map((anchor) => anchor.point),
    ...branchRoutes.flatMap((route) => [
      route.anchor,
      route.controlA,
      route.controlB,
      route.end,
      route.outlet,
      {
        x: route.label.x,
        y: route.label.y - MOBILE_BRANCH_CARD_HEIGHT / 2
      },
      {
        x: route.label.x + MOBILE_CARD_WIDTH,
        y: route.label.y + MOBILE_BRANCH_CARD_HEIGHT / 2
      }
    ])
  ];
  const minX = Math.min(...boundsPoints.map((point) => point.x));
  const minY = Math.min(...boundsPoints.map((point) => point.y));
  const maxX = Math.max(...boundsPoints.map((point) => point.x));
  const maxYWithCards = Math.max(...boundsPoints.map((point) => point.y));
  const offset = {
    x: Math.max(0, MOBILE_PADDING_X - minX),
    y: Math.max(0, MOBILE_PADDING_Y - minY)
  };
  const shiftedRoutes = branchRoutes.map((route) => shiftRoute(route, offset));
  const shiftedAnchors = mainBranchAnchors.map((anchor) => ({
    ...anchor,
    point: shiftPoint(anchor.point, offset)
  }));

  return {
    ...mainLayout,
    branchRoutes: shiftedRoutes,
    height: Math.max(MOBILE_MIN_CANVAS_HEIGHT, maxYWithCards + offset.y + MOBILE_PADDING_Y),
    mainBranchAnchors: shiftedAnchors,
    mainEnd: shiftPoint(mainLayout.mainEnd, offset),
    mainLabel: shiftPoint(mainLayout.mainLabel, offset),
    mainNode: shiftPoint(mainLayout.mainNode, offset),
    mainStart: shiftPoint(mainLayout.mainStart, offset),
    width: Math.max(MOBILE_MIN_CANVAS_WIDTH, maxX + offset.x + MOBILE_PADDING_X)
  };
};

const buildGraphLayout = (
  paths: GraphPath[],
  activePathId: string | null,
  nodePositionOverrides: Record<string, Point>,
  orientation: GraphOrientation
): Layout | null => {
  const topology = buildGraphTopology(paths, activePathId);

  if (!topology) {
    return null;
  }

  return orientation === "vertical"
    ? buildMobileLaneGraphLayout(topology, activePathId)
    : buildDesktopGraphLayout(topology, activePathId, nodePositionOverrides);
};

export const BranchGraph = ({
  activePathId,
  mainTitle,
  onSelectPath,
  paths
}: BranchGraphProps) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panSessionRef = useRef<PanSession | null>(null);
  const nodeDragSessionRef = useRef<NodeDragSession | null>(null);
  const touchPointsRef = useRef(new Map<number, TouchPoint>());
  const pinchSessionRef = useRef<PinchSession | null>(null);
  const fittedLayoutKeyRef = useRef<string | null>(null);
  const skipNextPositionPersistRef = useRef(false);
  const skipNextViewportPersistRef = useRef(false);
  const suppressNextNavigationRef = useRef(false);
  const isPhone = useMediaQuery(PHONE_MEDIA_QUERY);
  const orientation: GraphOrientation = isPhone ? "vertical" : "horizontal";
  const mainPathForStorage = useMemo(() => getMainPath(paths), [paths]);
  const storageKey = useMemo(
    () =>
      mainPathForStorage
        ? `${NODE_POSITION_STORAGE_PREFIX}.${mainPathForStorage.id}`
        : null,
    [mainPathForStorage]
  );
  const viewportStorageKey = useMemo(
    () =>
      mainPathForStorage
        ? orientation === "vertical"
          ? `${VIEWPORT_STORAGE_PREFIX}.${mainPathForStorage.id}.mobile-lanes`
          : `${VIEWPORT_STORAGE_PREFIX}.${mainPathForStorage.id}`
        : null,
    [mainPathForStorage, orientation]
  );
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [nodePositions, setNodePositions] = useState<Record<string, Point>>(() => {
    if (!mainPathForStorage || !storageKey) {
      return {};
    }

    return readStoredNodePositions(
      storageKey,
      new Set(paths.filter((path) => !path.isMain).map((path) => path.id))
    );
  });
  const [viewport, setViewport] = useState<ViewportTransform>(
    () =>
      (viewportStorageKey ? readStoredViewport(viewportStorageKey) : null) ??
      DEFAULT_VIEWPORT
  );
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const layout = useMemo(
    () =>
      buildGraphLayout(
        paths,
        activePathId,
        orientation === "vertical" ? {} : nodePositions,
        orientation
      ),
    [activePathId, nodePositions, orientation, paths]
  );
  const visibleMainTitle = mainTitle?.trim() || layout?.main.title || "Main chat";
  const layoutFitKey = useMemo(
    () => `${orientation}:${paths.map((path) => path.id).sort().join("|")}`,
    [orientation, paths]
  );

  useEffect(() => {
    const pathIds = new Set(paths.map((path) => path.id));

    setNodePositions((current) => {
      const entries = Object.entries(current).filter(([pathId]) => pathIds.has(pathId));

      if (entries.length === Object.keys(current).length) {
        return current;
      }

      return Object.fromEntries(entries);
    });
  }, [paths]);

  useEffect(() => {
    if (!storageKey) {
      setNodePositions({});
      return;
    }

    const validPathIds = new Set(
      paths.filter((path) => !path.isMain).map((path) => path.id)
    );

    fittedLayoutKeyRef.current = null;
    skipNextPositionPersistRef.current = true;
    setNodePositions(readStoredNodePositions(storageKey, validPathIds));
  }, [paths, storageKey]);

  useEffect(() => {
    if (!storageKey) {
      return;
    }

    if (skipNextPositionPersistRef.current) {
      skipNextPositionPersistRef.current = false;
      return;
    }

    const validPathIds = new Set(
      paths.filter((path) => !path.isMain).map((path) => path.id)
    );
    const filteredPositions = Object.fromEntries(
      Object.entries(nodePositions).filter(([pathId]) => validPathIds.has(pathId))
    );

    writeStoredNodePositions(storageKey, filteredPositions);
  }, [nodePositions, paths, storageKey]);

  useEffect(() => {
    fittedLayoutKeyRef.current = null;

    if (!viewportStorageKey) {
      setViewport(DEFAULT_VIEWPORT);
      return;
    }

    const storedViewport = readStoredViewport(viewportStorageKey);

    if (!storedViewport) {
      return;
    }

    fittedLayoutKeyRef.current = layoutFitKey;
    skipNextViewportPersistRef.current = true;
    setViewport(storedViewport);
  }, [layoutFitKey, viewportStorageKey]);

  useEffect(() => {
    if (!viewportStorageKey) {
      return;
    }

    if (skipNextViewportPersistRef.current) {
      skipNextViewportPersistRef.current = false;
      return;
    }

    writeStoredViewport(viewportStorageKey, viewport);
  }, [viewport, viewportStorageKey]);

  const fitToView = useCallback(() => {
    if (!layout || !viewportRef.current) {
      return;
    }

    const bounds = viewportRef.current.getBoundingClientRect();
    const fitPadding = isPhone ? MOBILE_FIT_PADDING : FIT_PADDING;
    const usableWidth = Math.max(1, bounds.width - fitPadding * 2);
    const usableHeight = Math.max(1, bounds.height - fitPadding * 2);
    const nextScale = clamp(
      Math.min(usableWidth / layout.width, usableHeight / layout.height),
      MIN_ZOOM,
      Math.min(1.08, MAX_ZOOM)
    );

    setViewport({
      scale: nextScale,
      x: (bounds.width - layout.width * nextScale) / 2,
      y: (bounds.height - layout.height * nextScale) / 2
    });
  }, [isPhone, layout]);

  const focusInitialView = useCallback(() => {
    if (!layout || !viewportRef.current) {
      return;
    }

    if (!isPhone) {
      fitToView();
      return;
    }

    const bounds = viewportRef.current.getBoundingClientRect();
    const target = {
      x: layout.mainLabel.x + MOBILE_MAIN_CARD_WIDTH / 2,
      y: layout.mainLabel.y
    };

    setViewport({
      scale: 1,
      x: bounds.width / 2 - target.x,
      y: bounds.height * 0.18 - target.y
    });
  }, [fitToView, isPhone, layout]);

  useEffect(() => {
    if (fittedLayoutKeyRef.current === layoutFitKey) {
      return;
    }

    fittedLayoutKeyRef.current = layoutFitKey;
    const frame = window.requestAnimationFrame(focusInitialView);

    return () => window.cancelAnimationFrame(frame);
  }, [focusInitialView, layoutFitKey]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(focusInitialView);

    return () => window.cancelAnimationFrame(frame);
  }, [focusInitialView, orientation]);

  useEffect(() => {
    const isTextEntryTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }

      return (
        target.isContentEditable ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT"
      );
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.code !== "Space" || isTextEntryTarget(event.target)) {
        return;
      }

      event.preventDefault();
      setIsSpacePressed(true);
    };

    const handleKeyUp = (event: globalThis.KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }

      event.preventDefault();
      setIsSpacePressed(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const zoomByAtPoint = useCallback(
    (factor: number, clientX: number, clientY: number) => {
      const bounds = viewportRef.current?.getBoundingClientRect();

      if (!bounds) {
        return;
      }

      setViewport((current) => {
        const nextScale = clamp(current.scale * factor, MIN_ZOOM, MAX_ZOOM);
        const localX = clientX - bounds.left;
        const localY = clientY - bounds.top;
        const worldX = (localX - current.x) / current.scale;
        const worldY = (localY - current.y) / current.scale;

        return {
          scale: nextScale,
          x: localX - worldX * nextScale,
          y: localY - worldY * nextScale
        };
      });
    },
    []
  );

  const zoomFromCenter = useCallback(
    (factor: number) => {
      const bounds = viewportRef.current?.getBoundingClientRect();

      if (!bounds) {
        return;
      }

      zoomByAtPoint(factor, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    },
    [zoomByAtPoint]
  );

  const zoomByGesture = useCallback((previous: PinchSession, next: PinchSession) => {
    const bounds = viewportRef.current?.getBoundingClientRect();

    if (!bounds) {
      return;
    }

    const scaleFactor = next.distance / previous.distance;

    setViewport((current) => {
      const nextScale = clamp(current.scale * scaleFactor, MIN_ZOOM, MAX_ZOOM);
      const previousLocalX = previous.center.clientX - bounds.left;
      const previousLocalY = previous.center.clientY - bounds.top;
      const nextLocalX = next.center.clientX - bounds.left;
      const nextLocalY = next.center.clientY - bounds.top;
      const worldX = (previousLocalX - current.x) / current.scale;
      const worldY = (previousLocalY - current.y) / current.scale;

      return {
        scale: nextScale,
        x: nextLocalX - worldX * nextScale,
        y: nextLocalY - worldY * nextScale
      };
    });
  }, []);

  if (!layout) {
    return null;
  }

  const handleNavigate = (pathId: string) => {
    if (suppressNextNavigationRef.current) {
      suppressNextNavigationRef.current = false;
      return;
    }

    onSelectPath(pathId);
  };

  const handleKeySelect = (pathId: string) => (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleNavigate(pathId);
    }
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const zoomFactor = Math.exp(-event.deltaY * 0.0012);

    zoomByAtPoint(zoomFactor, event.clientX, event.clientY);
  };

  const suppressNextNavigation = () => {
    suppressNextNavigationRef.current = true;
    window.setTimeout(() => {
      suppressNextNavigationRef.current = false;
    }, 0);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      touchPointsRef.current.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY
      });

      if (touchPointsRef.current.size >= 2) {
        panSessionRef.current = null;
        pinchSessionRef.current = getTouchGesture(touchPointsRef.current.values());
        setIsPanning(true);
        return;
      }

      panSessionRef.current = {
        hasMoved: false,
        lastX: event.clientX,
        lastY: event.clientY,
        pointerId: event.pointerId,
        totalDistance: 0
      };
      setIsPanning(true);
      return;
    }

    const shouldPan = event.button === 1 || (event.button === 0 && isSpacePressed);

    if (!shouldPan) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panSessionRef.current = {
      hasMoved: false,
      lastX: event.clientX,
      lastY: event.clientY,
      pointerId: event.pointerId,
      totalDistance: 0
    };
    setIsPanning(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      if (!touchPointsRef.current.has(event.pointerId)) {
        return;
      }

      event.preventDefault();
      touchPointsRef.current.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY
      });

      if (touchPointsRef.current.size >= 2) {
        const previousGesture = pinchSessionRef.current;
        const nextGesture = getTouchGesture(touchPointsRef.current.values());

        if (!previousGesture || !nextGesture) {
          return;
        }

        const centerDelta = Math.hypot(
          nextGesture.center.clientX - previousGesture.center.clientX,
          nextGesture.center.clientY - previousGesture.center.clientY
        );
        const distanceDelta = Math.abs(nextGesture.distance - previousGesture.distance);

        nextGesture.hasMoved =
          previousGesture.hasMoved ||
          centerDelta + distanceDelta > CLICK_DRAG_THRESHOLD;
        zoomByGesture(previousGesture, nextGesture);
        pinchSessionRef.current = nextGesture;
        return;
      }
    }

    const session = panSessionRef.current;

    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();

    const deltaX = event.clientX - session.lastX;
    const deltaY = event.clientY - session.lastY;

    session.totalDistance += Math.hypot(deltaX, deltaY);
    session.hasMoved = session.totalDistance > CLICK_DRAG_THRESHOLD;
    session.lastX = event.clientX;
    session.lastY = event.clientY;

    setViewport((current) => ({
      ...current,
      x: current.x + deltaX,
      y: current.y + deltaY
    }));
  };

  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      const wasTouching = touchPointsRef.current.has(event.pointerId);

      if (!wasTouching) {
        return;
      }

      touchPointsRef.current.delete(event.pointerId);

      if (pinchSessionRef.current) {
        if (pinchSessionRef.current.hasMoved) {
          suppressNextNavigation();
        }

        pinchSessionRef.current = null;

        const remainingTouch = touchPointsRef.current.entries().next().value as
          | [number, TouchPoint]
          | undefined;
        panSessionRef.current = remainingTouch
          ? {
              hasMoved: false,
              lastX: remainingTouch[1].clientX,
              lastY: remainingTouch[1].clientY,
              pointerId: remainingTouch[0],
              totalDistance: 0
            }
          : null;
        setIsPanning(Boolean(remainingTouch));
        return;
      }

      const touchSession = panSessionRef.current;

      if (touchSession?.pointerId === event.pointerId && touchSession.hasMoved) {
        suppressNextNavigation();
      }

      panSessionRef.current = null;
      setIsPanning(touchPointsRef.current.size > 0);
      return;
    }

    const session = panSessionRef.current;

    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    if (session.hasMoved) {
      suppressNextNavigation();
    }

    panSessionRef.current = null;
    setIsPanning(false);
  };

  const handleNodePointerDown =
    (pathId: string, startPosition: Point) => (event: PointerEvent<HTMLButtonElement>) => {
      if (isPhone) {
        event.stopPropagation();
        return;
      }

      if (event.pointerType === "touch") {
        event.stopPropagation();
        return;
      }

      if (event.button !== 0 || isSpacePressed) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      nodeDragSessionRef.current = {
        hasMoved: false,
        lastX: event.clientX,
        lastY: event.clientY,
        pathId,
        pointerId: event.pointerId,
        startPosition,
        totalDistance: 0
      };
      setDraggingNodeId(pathId);
      setNodePositions((current) => ({
        ...current,
        [pathId]: current[pathId] ?? startPosition
      }));
    };

  const handleNodePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const session = nodeDragSessionRef.current;

    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const deltaX = (event.clientX - session.lastX) / viewport.scale;
    const deltaY = (event.clientY - session.lastY) / viewport.scale;

    session.totalDistance += Math.hypot(event.clientX - session.lastX, event.clientY - session.lastY);
    session.hasMoved = session.totalDistance > CLICK_DRAG_THRESHOLD;
    session.lastX = event.clientX;
    session.lastY = event.clientY;

    setNodePositions((current) => {
      const currentPosition = current[session.pathId] ?? session.startPosition;

      return {
        ...current,
        [session.pathId]: {
          x: Math.max(60, currentPosition.x + deltaX),
          y: Math.max(60, currentPosition.y + deltaY)
        }
      };
    });
  };

  const endNodeDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const session = nodeDragSessionRef.current;

    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    event.stopPropagation();

    if (session.hasMoved) {
      suppressNextNavigation();
    }

    nodeDragSessionRef.current = null;
    setDraggingNodeId(null);
  };

  return (
    <section
      className={[
        "branch-graph",
        isPhone ? "branch-graph--phone" : "",
        orientation === "vertical" ? "branch-graph--vertical" : "branch-graph--horizontal"
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="branch-graph__canvas">
        <div className="branch-graph__controls" aria-label="Graph zoom controls">
          <button onClick={() => zoomFromCenter(ZOOM_STEP)} type="button">
            +
          </button>
          <button onClick={() => zoomFromCenter(1 / ZOOM_STEP)} type="button">
            -
          </button>
          <button onClick={fitToView} type="button">
            Fit
          </button>
        </div>

        <div
          className={[
            "branch-graph__viewport",
            isSpacePressed ? "branch-graph__viewport--hand" : "",
            isPanning ? "branch-graph__viewport--panning" : ""
          ]
            .filter(Boolean)
            .join(" ")}
          onDoubleClick={(event) => {
            const target = event.target;

            if (
              target instanceof Element &&
              !target.closest(".branch-graph-card") &&
              !target.classList.contains("branch-graph__branch-hit")
            ) {
              fitToView();
            }
          }}
          onPointerCancel={endPan}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPan}
          onWheel={handleWheel}
          ref={viewportRef}
        >
          <div
            className="branch-graph__scene"
            style={{
              height: `${layout.height}px`,
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
              width: `${layout.width}px`
            }}
          >
            <svg
              aria-label="Conversation branch navigator"
              className="branch-graph__svg"
              height={layout.height}
              role="img"
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              width={layout.width}
            >
              <defs>
                <filter id="branch-glow" x="-20%" y="-80%" width="140%" height="260%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <linearGradient id="mainline-gradient" x1="0%" x2="100%" y1="0%" y2="0%">
                  <stop offset="0%" stopColor="#00d2ff" stopOpacity="0.98" />
                  <stop offset="34%" stopColor="#00d2ff" stopOpacity="0.62" />
                  <stop offset="100%" stopColor="#2b3037" stopOpacity="0.88" />
                </linearGradient>
              </defs>

              <line
                className="branch-graph__main-axis-underlay"
                x1={layout.mainStart.x}
                x2={layout.mainEnd.x}
                y1={layout.mainStart.y}
                y2={layout.mainEnd.y}
              />
              <line
                className={[
                  "branch-graph__main-axis",
                  layout.activeLineage.has(layout.main.id)
                    ? "branch-graph__main-axis--active"
                    : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                x1={layout.mainStart.x}
                x2={layout.mainEnd.x}
                y1={layout.mainStart.y}
                y2={layout.mainEnd.y}
              />
              {layout.mainBranchAnchors.map((anchor) => (
                <circle
                  className={[
                    "branch-graph__anchor-dot",
                    anchor.isActiveLineage ? "branch-graph__anchor-dot--active" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  cx={anchor.point.x}
                  cy={anchor.point.y}
                  key={anchor.id}
                  r="5"
                />
              ))}

              {layout.branchRoutes.map((route) => (
                <g className="branch-graph__route" key={route.path.id}>
                  <path
                    aria-label={`Open ${route.path.title}`}
                    className="branch-graph__branch-hit"
                    d={route.d}
                    onClick={() => handleNavigate(route.path.id)}
                    onKeyDown={handleKeySelect(route.path.id)}
                    role="button"
                    tabIndex={0}
                  />
                  <path
                    className={[
                      "branch-graph__branch-path",
                      route.isOnActiveLineage ? "branch-graph__branch-path--active" : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    d={route.d}
                    filter={route.isOnActiveLineage ? "url(#branch-glow)" : undefined}
                  />
                  <circle
                    className={[
                      "branch-graph__branch-origin",
                      route.isOnActiveLineage ? "branch-graph__branch-origin--active" : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    cx={route.anchor.x}
                    cy={route.anchor.y}
                    r="4.5"
                  />
                  <circle
                    className={[
                      "branch-graph__branch-end",
                      route.isActive ? "branch-graph__branch-end--active" : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    cx={route.end.x}
                    cy={route.end.y}
                    r={route.isActive ? 8 : 6}
                  />
                </g>
              ))}
            </svg>

            <button
              className={[
                "branch-graph-card",
                "branch-graph-card--main",
                activePathId === layout.main.id ? "branch-graph-card--active" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              style={{
                left: `${layout.mainLabel.x}px`,
                top: `${layout.mainLabel.y}px`
              }}
              title={layout.main.title}
              type="button"
              onClick={() => handleNavigate(layout.main.id)}
            >
              <span>Main</span>
              <strong>{truncateTitle(visibleMainTitle, 34)}</strong>
            </button>

            {layout.branchRoutes.map((route) => (
              <button
                className={[
                  "branch-graph-card",
                  route.isActive ? "branch-graph-card--active" : "",
                  route.isOnActiveLineage ? "branch-graph-card--lit" : "",
                  route.side === -1
                    ? "branch-graph-card--lane-left"
                    : "branch-graph-card--lane-right",
                  draggingNodeId === route.path.id ? "branch-graph-card--dragging" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={route.path.id}
                onClick={() => handleNavigate(route.path.id)}
                onKeyDown={handleKeySelect(route.path.id)}
                onPointerCancel={endNodeDrag}
                onPointerDown={handleNodePointerDown(route.path.id, route.label)}
                onPointerMove={handleNodePointerMove}
                onPointerUp={endNodeDrag}
                style={{
                  left: `${route.label.x}px`,
                  top: `${route.label.y}px`
                }}
                title={`${route.path.title}\n${route.preview}`}
                type="button"
              >
                <span>{route.path.pathType}</span>
                <strong>{route.title}</strong>
                <small>
                  {route.childCount === 0
                    ? "No child branches"
                    : `${route.childCount} child ${route.childCount === 1 ? "branch" : "branches"}`}
                </small>
              </button>
            ))}
          </div>
        </div>

        <div className="branch-graph__legend">
          <div className="branch-graph__legend-item">
            <span className="branch-graph__legend-line branch-graph__legend-line--main" />
            <span>Straight main chat</span>
          </div>
          <div className="branch-graph__legend-item">
            <span className="branch-graph__legend-line branch-graph__legend-line--branch" />
            <span>{paths.filter((path) => !path.isMain).length} Curved branches</span>
          </div>
        </div>
      </div>
    </section>
  );
};
