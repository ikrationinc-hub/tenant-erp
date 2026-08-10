import type { ReactElement } from "react";
import type { FlatMenuEntry } from "../../core/navigation/menu-tree-utils";
import { BrokerScreen } from "./BrokerScreen";

const BROKERS_PATH = "/brokers";

/** DynamicRoutes' resolveScreen hook - mirrors modules/suppliers/supplier-registry.tsx exactly (a single, non-generic screen, not a masters entry). */
export function resolveBrokerScreen(entry: FlatMenuEntry, pathname: string): ReactElement | null {
  if (pathname !== BROKERS_PATH || entry.path !== BROKERS_PATH) {
    return null;
  }
  return <BrokerScreen />;
}
