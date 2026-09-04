import type { CSSProperties, ReactElement } from "react";
import { useState } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button, Empty, Flex, Input, Popconfirm, Space, Tag, Typography } from "antd";
import { HolderOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Can } from "../../core/permissions/Can";
import { semantic } from "../../theme/palette";

export interface ContractClauseItem {
  id: string;
  clauseTitle: string;
  clauseCode: string;
  resolvedText: string;
  isMandatory: boolean;
  isEdited: boolean;
  isFromRule: boolean;
}

interface SortableClauseCardProps {
  clause: ContractClauseItem;
  editable: boolean;
  onRemove: (contractClauseId: string) => void;
  onEditText: (contractClauseId: string, resolvedText: string) => void;
}

/** Mandatory (amber) takes precedence when a clause is both mandatory and rule-added - the removal restriction is the more important cue. Matches the prototype's own `.clause.mandatory`/`.clause.rule` left-border language, using our own semantic colors instead of the prototype's own CSS vars. */
function clauseBorderColor(clause: ContractClauseItem): string | undefined {
  if (clause.isMandatory) {
    return semantic.warning;
  }
  if (clause.isFromRule) {
    return "#7048e8";
  }
  return undefined;
}

/**
 * A flat bordered row (not a nested Card-in-Card) - closer to the
 * prototype's own compact `.clause` block: a grip handle on the left,
 * title + code + status tags on one line, the resolved text below, and
 * plain text-link actions ("Edit" / "Remove" / "Required by rule -
 * cannot remove") rather than icon-only buttons. Matches the prototype's
 * information density while staying on our own theme tokens.
 */
function SortableClauseCard({ clause, editable, onRemove, onEditText }: SortableClauseCardProps): ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: clause.id, disabled: !editable });
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(clause.resolvedText);

  const borderColor = clauseBorderColor(clause);
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderLeft: borderColor ? `3px solid ${borderColor}` : "1px solid #e5e7eb",
    borderRadius: 8,
    padding: "12px 14px",
    marginBottom: 8,
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
  };

  return (
    <div ref={setNodeRef} style={style}>
      {editable && (
        <Button
          type="text"
          size="small"
          icon={<HolderOutlined />}
          aria-label={`Drag to reorder ${clause.clauseTitle}`}
          style={{ cursor: "grab", marginTop: 2 }}
          {...attributes}
          {...listeners}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Flex wrap gap={8} align="center" style={{ marginBottom: 4 }}>
          <Typography.Text strong>{clause.clauseTitle}</Typography.Text>
          {clause.clauseCode && (
            <Tag bordered={false} style={{ background: "#f1f3f5", color: "#6b7280" }}>
              {clause.clauseCode}
            </Tag>
          )}
          {clause.isMandatory && <Tag color="warning">Mandatory</Tag>}
          {clause.isFromRule && (
            <Tag color="purple" icon={<ThunderboltOutlined />}>
              From rule
            </Tag>
          )}
          {clause.isEdited && <Tag color="orange">Edited</Tag>}
        </Flex>

        {editing ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Input.TextArea value={draftText} onChange={(e) => setDraftText(e.target.value)} autoSize={{ minRows: 2 }} />
            <Button
              size="small"
              type="primary"
              onClick={() => {
                onEditText(clause.id, draftText);
                setEditing(false);
              }}
            >
              Save text
            </Button>
          </Space>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12.5, whiteSpace: "pre-wrap" }}>
            {clause.resolvedText}
          </Typography.Text>
        )}

        {editable && !editing && (
          <div style={{ marginTop: 8 }}>
            {clause.isFromRule ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Required by rule - cannot remove
              </Typography.Text>
            ) : (
              <Space size="middle">
                <Typography.Link style={{ fontSize: 12.5 }} onClick={() => setEditing(true)}>
                  Edit on this contract
                </Typography.Link>
                <Popconfirm title="Remove this clause?" disabled={clause.isMandatory} onConfirm={() => onRemove(clause.id)}>
                  <Typography.Link
                    disabled={clause.isMandatory}
                    style={{ fontSize: 12.5, color: clause.isMandatory ? undefined : semantic.error }}
                  >
                    {clause.isMandatory ? "Cannot remove (mandatory)" : "Remove"}
                  </Typography.Link>
                </Popconfirm>
              </Space>
            )}
          </div>
        )}
        {!editable && (
          <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8 }}>
            Locked - snapshot frozen
          </Typography.Text>
        )}
      </div>
    </div>
  );
}

export interface ContractClauseListProps {
  clauses: ContractClauseItem[];
  editable: boolean;
  onReorder: (orderedIds: string[]) => void;
  onRemove: (contractClauseId: string) => void;
  onEditText: (contractClauseId: string, resolvedText: string) => void;
}

/** Item 8: assembled clauses as a DRAG-AND-DROP reorderable list (@dnd-kit/sortable) - disabled entirely once the contract leaves Draft (editable=false), matching the backend's own Draft-only assembly lock. */
export function ContractClauseList({ clauses, editable, onReorder, onRemove, onEditText }: ContractClauseListProps): ReactElement {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const oldIndex = clauses.findIndex((c) => c.id === active.id);
    const newIndex = clauses.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) {
      return;
    }
    onReorder(arrayMove(clauses, oldIndex, newIndex).map((c) => c.id));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={clauses.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        {clauses.map((clause) => (
          <SortableClauseCard key={clause.id} clause={clause} editable={editable} onRemove={onRemove} onEditText={onEditText} />
        ))}
      </SortableContext>
      {clauses.length === 0 && (
        <Can permission="contract.document.assemble">
          <Empty description="No clauses assembled yet. Add one from the library below." image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </Can>
      )}
    </DndContext>
  );
}
