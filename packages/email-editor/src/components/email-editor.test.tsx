import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { BlockComponent } from "../types/block-registry";
import type { Email } from "../types/email-editor";

if (!GlobalRegistrator.isRegistered)
  GlobalRegistrator.register({ url: "http://localhost/" });

const { act, cleanup, fireEvent, render, screen, within } = await import(
  "@testing-library/react"
);
const { EmailEditor } = await import("../email-editor");
const { defaultEmail } = await import("../lib/default-email");
const { Image, Link, Separator, Spacer, Text } = await import("../blocks");

afterEach(() => cleanup());
// Leave no DOM behind: the email renderer's tests need the real stream globals.
afterAll(() => GlobalRegistrator.unregister());

beforeAll(() => {
  // happy-dom has no layout; menus ask where they fit.
  Element.prototype.scrollIntoView = () => {};
});

/** A host's own block: a pull quote with a name and a line. */
const PullQuote: BlockComponent<{ line: string; by?: string }> = {
  block: ({ block }) => (
    <div data-testid="pull-quote">
      “{block.settings.line}” {block.settings.by}
    </div>
  ),
  settings: ({ block, updateBlock }) => (
    <input
      aria-label="Quote line"
      value={block.settings.line}
      onChange={(event) =>
        updateBlock(block.id, {
          settings: { ...block.settings, line: event.target.value },
        })
      }
    />
  ),
  quickEdit: ({ block, updateBlock }) => (
    <input
      aria-label="Quote by"
      value={block.settings.by ?? ""}
      onChange={(event) =>
        updateBlock(block.id, {
          settings: { ...block.settings, by: event.target.value },
        })
      }
    />
  ),
  metadata: {
    name: "pull-quote",
    displayName: "Pull quote",
    description: "A line from a customer",
    icon: () => null,
    docs: { settings: {} },
  },
  defaultSettings: () => ({ line: "It just works" }),
};

function email(content: Email["content"]): Email {
  return { ...defaultEmail, meta: { previewText: "Hi" }, content };
}

function mount(props: { email: Email; blocks?: BlockComponent[] }) {
  const onChange = mock<(next: Email) => void>();
  render(<EmailEditor email={props.email} onChange={onChange} blocks={props.blocks} />);
  const last = () => onChange.mock.calls.at(-1)?.[0] as Email;
  return { onChange, last };
}

const openInsertMenu = () => {
  fireEvent.click(screen.getAllByRole("button", { name: "Insert below" })[0]);
  return screen.getByRole("menu", { name: "Insert" });
};

describe("hosts that mount their own blocks", () => {
  it("works with only a custom block, offering nothing of ours", () => {
    const { last } = mount({
      email: email([
        { blockType: "pull-quote", settings: { line: "Love it", by: "Ana" } },
      ]),
      blocks: [PullQuote],
    });

    expect(screen.getByTestId("pull-quote").textContent).toContain("Love it");
    // Nothing to write in, so no prompt to keep writing.
    expect(screen.queryByText(/Keep writing/)).toBeNull();

    const menu = openInsertMenu();
    const tiles = within(menu)
      .getAllByRole("menuitem")
      .map((tile) => tile.textContent);
    expect(tiles).toEqual(["Pull quote"]);

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Pull quote" }));
    expect(last().content).toEqual([
      { blockType: "pull-quote", settings: { line: "Love it", by: "Ana" } },
      { blockType: "pull-quote", settings: { line: "It just works" } },
    ]);
  });

  it("edits a custom block through its own quick fields while writing", () => {
    const { last } = mount({
      email: email([{ blockType: "pull-quote", settings: { line: "Love it" } }]),
      blocks: [PullQuote],
    });

    fireEvent.click(screen.getByRole("button", { name: "Select: Pull quote" }));
    const toolbar = screen.getByRole("toolbar", { name: "Pull quote settings" });
    fireEvent.change(within(toolbar).getByLabelText("Quote by"), {
      target: { value: "Bo" },
    });
    expect(last().content).toEqual([
      { blockType: "pull-quote", settings: { line: "Love it", by: "Bo" } },
    ]);
  });

  it("keeps working when our text block is left out", () => {
    mount({
      email: email([{ blockType: "separator", settings: {} }]),
      blocks: [Image, Separator, PullQuote],
    });
    const tiles = within(openInsertMenu())
      .getAllByRole("menuitem")
      .map((tile) => tile.textContent);
    expect(tiles).toEqual(["Image", "Divider", "Pull quote"]);
    expect(tiles).not.toContain("Text");
    expect(tiles).not.toContain("Button");
  });

  it("treats a host's own block named text as an ordinary block", () => {
    const HostText: BlockComponent = {
      ...PullQuote,
      block: ({ block }) => <p data-testid="host-text">{block.settings.html}</p>,
      metadata: { ...PullQuote.metadata, name: "text", displayName: "Rich text" },
    };
    const { last } = mount({
      email: email([{ blockType: "text", settings: { html: "<b>Hi</b>\n\nThere" } }]),
      blocks: [HostText],
    });

    // One block, not split into paragraphs, and selectable rather than typed into.
    expect(screen.getAllByTestId("host-text")).toHaveLength(1);
    expect(screen.queryByRole("textbox", { name: /Text/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Select: Rich text" }));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(last().content).toEqual([
      { blockType: "text", settings: { html: "<b>Hi</b>\n\nThere" } },
      { blockType: "text", settings: { html: "<b>Hi</b>\n\nThere" } },
    ]);
  });

  it("passes a custom block through untouched while text around it is edited", () => {
    const { last } = mount({
      email: email([
        { blockType: "text", settings: { content: "First\n\nSecond" } },
        { blockType: "pull-quote", settings: { line: "Keep me", extra: [1, 2] } },
      ]),
      blocks: [Text, Link, PullQuote],
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit: Text 2" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Text 2" }), {
      target: { value: "Second, edited" },
    });
    expect(last().content).toEqual([
      { blockType: "text", settings: { content: "First\n\nSecond, edited" } },
      { blockType: "pull-quote", settings: { line: "Keep me", extra: [1, 2] } },
    ]);
  });
});

describe("writing paragraph by paragraph", () => {
  const start = () =>
    mount({
      email: email([{ blockType: "text", settings: { content: "Hello world" } }]),
      blocks: [Text, Link, Separator],
    });

  const editor = (name = /^Text/) =>
    screen.getByRole("textbox", { name }) as HTMLTextAreaElement;

  it("splits a paragraph on Enter and joins it back on Backspace", () => {
    const { last } = start();
    fireEvent.click(screen.getByRole("button", { name: "Edit: Text 1" }));
    const first = editor();
    first.setSelectionRange(5, 5);
    fireEvent.keyDown(first, { key: "Enter" });
    expect(last().content[0].settings.content).toBe("Hello\n\n world");

    const second = editor();
    expect(second.value).toBe(" world");
    second.setSelectionRange(0, 0);
    fireEvent.keyDown(second, { key: "Backspace" });
    expect(last().content[0].settings.content).toBe("Hello world");
  });

  it("turns markdown shortcuts into headings and lists", () => {
    const { last } = start();
    fireEvent.click(screen.getByRole("button", { name: "Edit: Text 1" }));
    fireEvent.change(editor(), {
      target: { value: "## Hello world", selectionStart: 3 },
    });
    expect(last().content[0].settings.content).toBe("## Hello world");
    expect(editor().value).toBe("Hello world");

    // Backspace at the start of a heading makes it a paragraph again.
    editor().setSelectionRange(0, 0);
    fireEvent.keyDown(editor(), { key: "Backspace" });
    expect(last().content[0].settings.content).toBe("Hello world");
  });

  it("continues a list on Enter and ends it on an empty item", () => {
    const { last } = mount({
      email: email([{ blockType: "text", settings: { content: "- one" } }]),
      blocks: [Text],
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit: Text 1" }));
    editor().setSelectionRange(3, 3);
    fireEvent.keyDown(editor(), { key: "Enter" });
    fireEvent.change(editor(), { target: { value: "two" } });
    expect(last().content[0].settings.content).toBe("- one\n- two");

    editor().setSelectionRange(3, 3);
    fireEvent.keyDown(editor(), { key: "Enter" });
    fireEvent.keyDown(editor(), { key: "Enter" });
    fireEvent.change(editor(), { target: { value: "After" } });
    expect(last().content[0].settings.content).toBe("- one\n- two\n\nAfter");
  });

  it("deletes an empty paragraph after a button and selects the button", () => {
    const { last } = mount({
      email: email([
        {
          blockType: "link",
          settings: { text: "Go", url: "https://x.co", isButton: true },
        },
        { blockType: "text", settings: { content: "" } },
      ]),
      blocks: [Text, Link],
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit: Text 2" }));
    fireEvent.change(editor(), { target: { value: "x" } });
    fireEvent.change(editor(), { target: { value: "" } });
    editor().setSelectionRange(0, 0);
    fireEvent.keyDown(editor(), { key: "Backspace" });
    expect(last().content).toEqual([
      {
        blockType: "link",
        settings: { text: "Go", url: "https://x.co", isButton: true },
      },
    ]);
    expect(screen.getByRole("toolbar", { name: "Link settings" })).toBeTruthy();
  });

  it("splits a pasted run of paragraphs into items", async () => {
    const { last } = start();
    fireEvent.click(screen.getByRole("button", { name: "Edit: Text 1" }));
    editor().setSelectionRange(11, 11);
    await act(async () => {
      fireEvent.paste(editor(), {
        clipboardData: { getData: () => " first\n\n- second\nthird" },
      });
    });
    expect(last().content[0].settings.content).toBe(
      "Hello world first\n\n- second\n\nthird",
    );
    expect(screen.getByRole("status").textContent).toBe("Pasted 3 paragraphs");
  });
});

describe("block settings from the keyboard", () => {
  const start = () =>
    mount({
      email: email([
        { blockType: "text", settings: { content: "Before" } },
        {
          blockType: "link",
          settings: { text: "Go", url: "https://x.co", isButton: true },
        },
        { blockType: "text", settings: { content: "After" } },
      ]),
      blocks: [Text, Link],
    });
  const settle = () => act(() => new Promise((done) => setTimeout(done, 80)));
  const popover = () => screen.queryByRole("toolbar", { name: "Link settings" });
  const selectButton = () => screen.getByRole("button", { name: "Select: Link" });

  it("closes on Escape and hands focus back to the block", async () => {
    start();
    fireEvent.click(selectButton());
    await settle();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Button text");

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await settle();
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(selectButton());

    // Enter on the block opens its settings again.
    fireEvent.click(document.activeElement!);
    expect(popover()).toBeTruthy();
  });

  it("closes when focus tabs on to another row", async () => {
    start();
    fireEvent.click(selectButton());
    await settle();
    act(() => screen.getByRole("button", { name: "Edit: Text 3" }).focus());
    expect(popover()).toBeNull();
  });

  it("carries on writing below the block after Enter in a field", async () => {
    start();
    fireEvent.click(selectButton());
    await settle();
    fireEvent.keyDown(screen.getByLabelText("Button link"), { key: "Enter" });
    await settle();
    expect(popover()).toBeNull();
    expect(
      (screen.getByRole("textbox", { name: /^Text/ }) as HTMLTextAreaElement).value,
    ).toBe("After");
  });

  it("stops on the block when arrowing through the text", async () => {
    start();
    fireEvent.click(screen.getByRole("button", { name: "Edit: Text 1" }));
    const first = screen.getByRole("textbox", { name: /^Text/ }) as HTMLTextAreaElement;
    first.setSelectionRange(6, 6);
    fireEvent.keyDown(first, { key: "ArrowDown" });
    await settle();
    expect(document.activeElement).toBe(selectButton());
    expect(popover()).toBeNull();

    fireEvent.keyDown(selectButton(), { key: "ArrowDown" });
    await settle();
    expect(
      (screen.getByRole("textbox", { name: /^Text/ }) as HTMLTextAreaElement).value,
    ).toBe("After");
  });

  it("moves focus to the text above when a block is deleted", async () => {
    start();
    fireEvent.click(selectButton());
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await settle();
    const editor = document.activeElement as HTMLTextAreaElement;
    expect(editor.tagName).toBe("TEXTAREA");
    expect(editor.value).toBe("Before");
  });

  it("starts on the first control of blocks without a text field", async () => {
    mount({
      email: email([{ blockType: "spacer", settings: { height: "20px" } }]),
      blocks: [Text, Spacer],
    });
    fireEvent.click(screen.getByRole("button", { name: "Select: Spacer" }));
    await settle();
    expect(document.activeElement?.textContent).toBe("Small");
    const medium = screen.getByRole("button", { name: "Medium" });
    expect(medium.getAttribute("aria-pressed")).toBe("true");
  });

  it("drives the insert menu with the keyboard", async () => {
    start();
    fireEvent.click(screen.getAllByRole("button", { name: "Insert below" })[0]);
    await settle();
    const menu = screen.getByRole("menu", { name: "Insert" });
    const items = within(menu).getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: "ArrowUp" });
    fireEvent.keyDown(items[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[items.length - 1]);

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Insert" })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getAllByRole("button", { name: "Insert below" })[0],
    );
  });
});
