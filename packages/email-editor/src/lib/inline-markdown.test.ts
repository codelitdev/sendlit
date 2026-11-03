import { describe, expect, it } from "bun:test";
import { mayBeBlank, segments, setFallback, tagUses } from "./inline-markdown";

describe("segments", () => {
  it("splits bold, italic, links and merge tags", () => {
    expect(
      segments(
        'Hi {{ subscriber.name | default: "there" }}, **read** *this* [now](https://x.y)',
      ),
    ).toEqual([
      { type: "text", text: "Hi " },
      { type: "tag", path: "subscriber.name", fallback: "there" },
      { type: "text", text: ", " },
      { type: "bold", text: "read" },
      { type: "text", text: " " },
      { type: "italic", text: "this" },
      { type: "text", text: " " },
      { type: "link", text: "now", url: "https://x.y" },
    ]);
  });
});

describe("fallbacks", () => {
  it("finds uses with and without a fallback", () => {
    expect(tagUses('{{ subscriber.name }} {{ event.plan | default: "free" }}')).toEqual(
      [
        { path: "subscriber.name", hasFallback: false },
        { path: "event.plan", hasFallback: true },
      ],
    );
  });

  it("sets, replaces and clears a fallback on every use", () => {
    const text = 'Hi {{ subscriber.name }} and {{subscriber.name | default: "x"}}';
    const set = setFallback(text, "subscriber.name", 'th"ere');
    expect(set).toBe(
      'Hi {{ subscriber.name | default: "there" }} and {{ subscriber.name | default: "there" }}',
    );
    expect(setFallback(set, "subscriber.name", "")).toBe(
      "Hi {{ subscriber.name }} and {{ subscriber.name }}",
    );
  });

  it("only asks for fallbacks that can be blank", () => {
    expect(mayBeBlank("subscriber.name")).toBe(true);
    expect(mayBeBlank("event.plan")).toBe(true);
    expect(mayBeBlank("subscriber.email")).toBe(false);
    expect(mayBeBlank("view_in_browser_url")).toBe(false);
    expect(mayBeBlank("customer.name")).toBe(false);
  });
});
