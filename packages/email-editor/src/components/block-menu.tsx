import type { MenuPlacement } from "../lib/menu-placement";
import type { BlockChoice, EditorVariable } from "../types/editor-ui";

/** The insert menu: a grid of text kinds and blocks, with merge tags below. */
export function BlockMenu({
  choices,
  index,
  onPick,
  onHover,
  variables = [],
  onPickVariable,
  placement,
  header,
}: {
  choices: BlockChoice[];
  /** Highlighted entry; choices first, then variables. */
  index: number;
  onPick: (choice: BlockChoice) => void;
  onHover?: (index: number) => void;
  variables?: EditorVariable[];
  onPickVariable?: (variable: EditorVariable) => void;
  placement?: MenuPlacement;
  header?: string;
}) {
  return (
    <div
      className={`sle-menu grid${placement?.up ? " up" : ""}`}
      style={placement && { maxHeight: placement.maxHeight }}
      role="menu"
      aria-label="Insert"
      onMouseDown={(event) => event.preventDefault()}
    >
      {header && <div className="mh">{header}</div>}
      <div className="sle-tiles">
        {choices.length === 0 && <p className="empty">Nothing matches.</p>}
        {choices.map((choice, i) => {
          const Icon = choice.icon;
          return (
            <button
              key={choice.id}
              type="button"
              role="menuitem"
              className={i === index ? "first" : undefined}
              onMouseEnter={() => onHover?.(i)}
              onClick={() => onPick(choice)}
            >
              <span className="mi">
                <Icon className="size-4" />
              </span>
              {choice.name}
            </button>
          );
        })}
      </div>
      {variables.length > 0 && onPickVariable && (
        <div className="pz">
          <span className="mh">Merge tags</span>
          <div className="sle-chips">
            {variables.slice(0, 4).map((variable, i) => (
              <button
                key={variable.tag}
                type="button"
                className={`sle-chip${choices.length + i === index ? " first" : ""}`}
                onClick={() => onPickVariable(variable)}
              >
                {variable.tag.replace(/[{}]/g, "").trim()}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Merge tags offered while typing `{{`. */
export function VariableMenu({
  variables,
  index,
  onPick,
  onHover,
  placement,
}: {
  variables: EditorVariable[];
  index: number;
  onPick: (variable: EditorVariable) => void;
  onHover?: (index: number) => void;
  placement?: MenuPlacement;
}) {
  return (
    <div
      className={`sle-menu${placement?.up ? " up" : ""}`}
      style={placement && { maxHeight: placement.maxHeight }}
      role="menu"
      aria-label="Merge tags"
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="mh">Insert a merge tag</div>
      {variables.map((variable, i) => (
        <button
          key={variable.tag}
          type="button"
          role="menuitem"
          className={i === index ? "first" : undefined}
          onMouseEnter={() => onHover?.(i)}
          onClick={() => onPick(variable)}
        >
          <span className="mt">
            <b>
              <code>{variable.tag.replace(/[{}]/g, "").trim()}</code>
            </b>
            <em>{variable.description}</em>
          </span>
        </button>
      ))}
    </div>
  );
}
