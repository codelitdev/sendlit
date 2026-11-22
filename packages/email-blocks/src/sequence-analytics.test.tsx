import { describe, expect, it } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { RefreshButton, SequenceAnalytics } from "./sequence-analytics";

/** Every element in a rendered tree, depth first. */
function elementsIn(
  node: ReactNode,
): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(node)) return node.flatMap(elementsIn);
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>;
  return [{ type: node.type, props }, ...elementsIn(props.children as ReactNode)];
}

describe("SequenceAnalytics", () => {
  it("shows a refresh button wired to onRefresh when one is given", () => {
    const onRefresh = async () => {};
    const elements = elementsIn(
      SequenceAnalytics({ metrics: [], title: "Performance", onRefresh }),
    );
    const refresh = elements.find((element) => element.type === RefreshButton);
    expect(refresh?.props.onRefresh).toBe(onRefresh);
  });

  it("has no refresh button without onRefresh", () => {
    const elements = elementsIn(
      SequenceAnalytics({ metrics: [], title: "Performance" }),
    );
    expect(elements.some((element) => element.type === "h3")).toBe(true);
    expect(elements.some((element) => element.type === RefreshButton)).toBe(false);
  });

  it("renders a selectable metric's value as a button", () => {
    const onSelect = () => {};
    const elements = elementsIn(
      SequenceAnalytics({
        metrics: [
          {
            label: "Bounce rate",
            value: "3.0%",
            onSelect,
            selectLabel: "View bounces",
          },
          { label: "Sent", value: 10 },
        ],
      }),
    );
    const buttons = elements.filter(
      (element) => element.type === "button" && element.props.onClick === onSelect,
    );
    expect(buttons).toHaveLength(1);
    expect(buttons[0].props["aria-label"]).toBe("Bounce rate 3.0%: View bounces");
    expect(buttons[0].props.children).toBe("3.0%");
  });
});
