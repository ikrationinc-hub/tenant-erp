import type { ReactElement } from "react";
import { useState } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button, Card, Input, Popconfirm, Space, Tag, Typography } from "antd";
import { DeleteOutlined, DragOutlined, EditOutlined } from "@ant-design/icons";
import { Can } from "../../core/permissions/Can";

export interface ContractClauseItem {
  id: string;
  clauseTitle: string;
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

function SortableClauseCard({ clause, editable, onRemove, onEditText }: SortableClauseCardProps): ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: clause.id, disabled: !editable });
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(clause.resolvedText);

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} style={style}>
      <Card
        size="small"
        style={{ marginBottom: 8 }}
        title={
          <Space>
            {editable && (
              <Button type="text" size="small" icon={<DragOutlined />} aria-label={`Drag to reorder ${clause.clauseTitle}`} {...attributes} {...listeners} />
            )}
            <Typography.Text strong>{clause.clauseTitle}</Typography.Text>
            {clause.isMandatory && <Tag>Mandatory</Tag>}
            {clause.isFromRule && <Tag color="purple">From rule</Tag>}
            {clause.isEdited && <Tag color="orange">Edited</Tag>}
          </Space>
        }
        extra={
          editable && (
            <Space>
              <Button type="text" size="small" icon={<EditOutlined />} aria-label={`Edit ${clause.clauseTitle}`} onClick={() => setEditing((v) => !v)} />
              <Popconfirm
                title="Remove this clause?"
                disabled={clause.isMandatory}
                onConfirm={() => onRemove(clause.id)}
              >
                <Button type="text" size="small" danger icon={<DeleteOutlined />} disabled={clause.isMandatory} aria-label={`Remove ${clause.clauseTitle}`} />
              </Popconfirm>
            </Space>
          )
        }
      >
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
          <Typography.Paragraph style={{ margin: 0, whiteSpace: "pre-wrap" }}>{clause.resolvedText}</Typography.Paragraph>
        )}
      </Card>
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
          <Typography.Text type="secondary">No clauses assembled yet. Add one from the library below.</Typography.Text>
        </Can>
      )}
    </DndContext>
  );
}
