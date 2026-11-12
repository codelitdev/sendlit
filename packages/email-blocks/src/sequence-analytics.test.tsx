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
});
