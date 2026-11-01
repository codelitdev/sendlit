import {
  ArrowDown,
  ArrowUp,
  Copy,
  GripVertical,
  Lock,
  Plus,
  Trash2,
} from "lucide-react";
import type { CSSProperties, DragEvent, ReactNode } from "react";
import type { BlockRegistry } from "../types/block-registry";
import type { EmailBlock, EmailStyle } from "../types/email-editor";

export interface RowEvents {
  onOpenInsert: (id: string) => void;
  onGripClick: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  onDragStart: (id: string) => void;
  onDragOver: (id: string, edge: "before" | "after") => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

/** The insert and drag handles beside a row while writing. */
function Gutter({
  id,
  canAddBelow,
  movable,
  events,
}: {
  id: string;
  canAddBelow: boolean;
  movable: boolean;
  events: RowEvents;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keeps gutter clicks off the canvas
    <div className="sle-gut" onClick={(event) => event.stopPropagation()}>
      {canAddBelow && (
        <button
          type="button"
          aria-label="Insert below"
          title="Insert below"
          onClick={() => events.onOpenInsert(id)}
        >
          <Plus className="size-3.5" />
        </button>
      )}
      {movable && (
        <button
          type="button"
          className="grip"
          aria-label="Drag to move, or use the arrow keys"
          title="Drag to move. Click to select."
          draggable
          onClick={() => events.onGripClick(id)}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              events.onMove(id, event.key === "ArrowUp" ? "up" : "down");
            }
          }}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", id);
            events.onDragStart(id);
          }}
          onDragEnd={events.onDragEnd}
        >
          <GripVertical className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function dropHandlers(id: string, events: RowEvents) {
  return {
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      events.onDragOver(
        id,
        event.clientY < rect.top + rect.height / 2 ? "before" : "after",
      );
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      events.onDrop();
    },
  };
}

function rowClass(parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/** A paragraph, heading, list item or quote while writing. */
export function ItemRow({
  id,
  active,
  dragging,
  dropEdge,
  canAddBelow,
  movable,
  style,
  events,
  children,
  floating,
}: {
  id: string;
  active: boolean;
  dragging: boolean;
  dropEdge: "before" | "after" | null;
  canAddBelow: boolean;
  movable: boolean;
  style: CSSProperties;
  events: RowEvents;
  children: ReactNode;
  floating?: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop target for reordering
    <div
      className={rowClass([
        "it",
        "text",
        active && "active",
        dragging && "dragged",
        dropEdge && `drop-${dropEdge}`,
      ])}
      data-block-id={id}
      style={style}
      {...dropHandlers(id, events)}
    >
      <Gutter id={id} canAddBelow={canAddBelow} movable={movable} events={events} />
      {children}
      {floating}
    </div>
  );
}

export interface BlockRowProps {
  block: Required<EmailBlock>;
  style: EmailStyle;
  blockRegistry: BlockRegistry;
  renderContext?: unknown;
  mode: "write" | "style";
  selected: boolean;
  dragging: boolean;
  dropEdge: "before" | "after" | null;
  capabilities: {
    canDelete: boolean;
    canDuplicate: boolean;
    canMoveUp: boolean;
    canMoveDown: boolean;
    canAddBelow: boolean;
    movable: boolean;
  };
  /** Rendered under the row: the insert menu or the block's quick settings. */
  floating?: ReactNode;
  events: RowEvents;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}

/** Any block shown as it renders: buttons, images, columns, a whole text block
 * in Style mode, and blocks a host adds. Clicking selects it. */
export function BlockRow(props: BlockRowProps) {
  const {
    block,
    style,
    blockRegistry,
    renderContext,
    mode,
    selected,
    capabilities,
    events,
  } = props;
  const component = blockRegistry[block.blockType];
  const label = component?.metadata.displayName ?? block.blockType;
  const Block = component?.block;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop target for reordering
    <div
      className={rowClass([
        "it",
        "obj",
        selected && "on",
        props.dragging && "dragged",
        props.dropEdge && `drop-${props.dropEdge}`,
      ])}
      data-block-id={block.id}
      {...dropHandlers(block.id, events)}
    >
      {mode === "write" && (
        <Gutter
          id={block.id}
          canAddBelow={capabilities.canAddBelow}
          movable={capabilities.movable}
          events={events}
        />
      )}
      {Block ? (
        <Block
          block={block}
          style={style}
          selectedBlockId={selected ? block.id : null}
          renderContext={renderContext}
          showConditionals
        />
      ) : (
        <div>Unknown block type: {block.blockType}</div>
      )}
      <button
        type="button"
        className="sle-hit"
        aria-label={`Select: ${label}`}
        onClick={(event) => {
          event.stopPropagation();
          props.onSelect(block.id);
        }}
      />

      {/* While writing, the gutter's grip moves blocks and the popover holds
          the rest, so the side bar is only for Style mode. */}
      {selected && mode === "style" && (
        // biome-ignore lint/a11y/noStaticElementInteractions: keeps toolbar clicks off the canvas
        <div className="sle-bar" onClick={(event) => event.stopPropagation()}>
          {capabilities.canMoveUp && (
            <button
              type="button"
              aria-label="Move up"
              title="Move up"
              onClick={() => events.onMove(block.id, "up")}
            >
              <ArrowUp className="size-3.5" />
            </button>
          )}
          {capabilities.canMoveDown && (
            <button
              type="button"
              aria-label="Move down"
              title="Move down"
              onClick={() => events.onMove(block.id, "down")}
            >
              <ArrowDown className="size-3.5" />
            </button>
          )}
          {capabilities.canDuplicate && (
            <button
              type="button"
              aria-label="Duplicate"
              title="Duplicate"
              onClick={() => props.onDuplicate(block.id)}
            >
              <Copy className="size-3.5" />
            </button>
          )}
          {capabilities.canDelete && (
            <button
              type="button"
              className="del"
              aria-label="Delete"
              title="Delete"
              onClick={() => props.onDelete(block.id)}
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
          {!capabilities.canDelete && (
            <span className="lock" title={`${label} is required and can't be removed`}>
              <Lock className="size-3.5" />
            </span>
          )}
        </div>
      )}
      {props.floating}
    </div>
  );
}
