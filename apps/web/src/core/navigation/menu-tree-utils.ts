import type { MenuNode } from "@hyperion/contracts";

export interface FlatMenuEntry {
  path: string;
  label: string;
  /** Ancestors first, this node last - what a breadcrumb trail renders directly. */
  trail: MenuNode[];
}

/** Every node with a path, anywhere in the tree, each carrying its own ancestor trail - the single source both route-matching (DynamicRoutes) and breadcrumbs (MenuBreadcrumbs) read from. */
export function flattenMenuPaths(nodes: MenuNode[], trail: MenuNode[] = []): FlatMenuEntry[] {
  const entries: FlatMenuEntry[] = [];
  for (const node of nodes) {
    const nextTrail = [...trail, node];
    if (node.path) {
      entries.push({ path: node.path, label: node.label, trail: nextTrail });
    }
    entries.push(...flattenMenuPaths(node.children, nextTrail));
  }
  return entries;
}

export function findBreadcrumbTrail(nodes: MenuNode[], pathname: string): MenuNode[] | null {
  const match = flattenMenuPaths(nodes).find((entry) => entry.path === pathname);
  return match ? match.trail : null;
}
