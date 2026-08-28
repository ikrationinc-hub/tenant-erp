import type { ReactElement } from "react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, Col, Row, Typography } from "antd";
import type { MenuNode } from "@ikration/contracts";
import { useMenuTree } from "../../core/navigation/use-menu-tree";
import { resolveMenuIcon } from "../../core/navigation/icon-registry";
import { flattenMenuPaths } from "../../core/navigation/menu-tree-utils";
import { steelCobalt } from "../../theme/palette";

interface LauncherGroup {
  name: string;
  links: MenuNode[];
}

interface LauncherSection {
  name: string;
  groups: LauncherGroup[];
}

/**
 * Buckets every settings leaf link by its launcherSection -> launcherGroup
 * pair (seed-menu-tree.ts), preserving first-seen order for both levels so
 * the launcher's layout follows the seed tree's own ordering rather than
 * re-sorting alphabetically. A node with no launcherSection (the "Masters"
 * parent itself, which has no path) contributes only its children, which
 * DO carry launcherSection/launcherGroup - see seed-menu-tree.ts's
 * buildMastersChildren.
 */
function buildSections(settingsNodes: MenuNode[]): LauncherSection[] {
  const leaves = [
    ...settingsNodes.filter((node) => node.path && node.launcherSection),
    ...flattenMenuPaths(settingsNodes)
      .map((entry) => entry.trail[entry.trail.length - 1] as MenuNode)
      .filter((node) => node.launcherSection),
  ];

  const sections: LauncherSection[] = [];
  for (const leaf of leaves) {
    const sectionName = leaf.launcherSection as string;
    const groupName = leaf.launcherGroup ?? leaf.label;

    let section = sections.find((s) => s.name === sectionName);
    if (!section) {
      section = { name: sectionName, groups: [] };
      sections.push(section);
    }
    let group = section.groups.find((g) => g.name === groupName);
    if (!group) {
      group = { name: groupName, links: [] };
      section.groups.push(group);
    }
    if (!group.links.some((link) => link.key === leaf.key)) {
      group.links.push(leaf);
    }
  }
  return sections;
}

/**
 * Zoho's "All Settings" launcher (prototype: docs/mockups/ikration-settings-
 * prototype.html) - grouped headings ("Organization Settings", "Master
 * Data") each holding several cards ("Users & Roles", "Geography"), each
 * card listing its links. Entirely driven by the live GET /menus tree
 * (frontend rule 2) via launcherSection/launcherGroup: no hardcoded group
 * names or routes here, so a settings node added to the menu tree with
 * those two fields set appears here for free.
 */
export function SettingsLauncher(): ReactElement {
  const { data } = useMenuTree();
  const navigate = useNavigate();

  const settingsNodes = useMemo(() => (data?.menus ?? []).filter((node) => node.section === "settings"), [data]);
  const sections = useMemo(() => buildSections(settingsNodes), [settingsNodes]);

  return (
    <div style={{ maxWidth: 1150, margin: "0 auto" }}>
      {sections.map((section) => (
        <div key={section.name} style={{ marginBottom: 32 }}>
          <Typography.Title level={4} style={{ marginBottom: 16 }}>
            {section.name}
          </Typography.Title>
          <Row gutter={[16, 16]}>
            {section.groups.map((group) => {
              const Icon = resolveMenuIcon(group.links[0]?.icon ?? null);
              return (
                <Col key={group.name} xs={24} sm={12} lg={6}>
                  <Card size="small" style={{ height: "100%" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          background: `${steelCobalt.base}1a`,
                          color: steelCobalt.base,
                          flexShrink: 0,
                        }}
                      >
                        <Icon />
                      </span>
                      <Typography.Text strong>{group.name}</Typography.Text>
                    </div>
                    {group.links.map((link) => (
                      <Typography.Paragraph key={link.key} style={{ marginBottom: 6 }}>
                        <Typography.Link onClick={() => link.path && void navigate(link.path)}>{link.label}</Typography.Link>
                      </Typography.Paragraph>
                    ))}
                  </Card>
                </Col>
              );
            })}
          </Row>
        </div>
      ))}
    </div>
  );
}
