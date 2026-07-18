import type { RouteObject } from "react-router-dom";
import { BootstrapStatus } from "./BootstrapStatus";

/**
 * Empty of hardcoded BUSINESS routes (frontend rule 2) - FE-4 replaces this
 * array with routes generated from GET /menus. The single root entry is
 * shell scaffolding, not a module screen: it exists so the router has
 * somewhere to render while the rest of the provider stack is exercised.
 */
export const routes: RouteObject[] = [{ path: "/", element: <BootstrapStatus /> }];
