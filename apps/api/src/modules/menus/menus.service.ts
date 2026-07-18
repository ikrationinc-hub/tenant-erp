import type { RequestContext } from "../../common/context/request-context.js";
import { resolveMenuTree, type MenuNode } from "../../core/menu-engine/resolve.js";

export async function getMenuTree(ctx: RequestContext): Promise<MenuNode[]> {
  return resolveMenuTree(ctx);
}
