import { describe, expect, it } from "bun:test";
import type { Email } from "../types/email-editor";
import { checklistLabel, computeChecklist } from "./checklist";
import { defaultEmail } from "./default-email";

function email(content: Email["content"], previewText = "A preview"): Email {
  return {
    ...defaultEmail,
    meta: { previewText },
    content: content.map((block, index) => ({ ...block, id: `b${index}` })),
  };
}

const text = { blockType: "text", settings: { content: "Hello" } };
const ids = (items: ReturnType<typeof computeChecklist>) => items.map((i) => i.id);

describe("computeChecklist", () => {
  it("is clean for a complete email", () => {
    expect(
      computeChecklist({ email: email([text]), subject: "Welcome aboard" }),
    ).toEqual([]);
  });

  it("asks for a subject only when the host edits one", () => {
    expect(ids(computeChecklist({ email: email([text]), subject: "  " }))).toEqual([
      "subject-missing",
    ]);
    expect(computeChecklist({ email: email([text]) })).toEqual([]);
  });

  it("flags spammy or long subjects as should-fix", () => {
    const long = computeChecklist({ email: email([text]), subject: "x".repeat(61) });
    expect(long[0].fixLabel).toBe("Shorten");
    expect(long.map((i) => [i.id, i.level])).toEqual([["subject-long", "should"]]);
    expect(
      ids(computeChecklist({ email: email([text]), subject: "HUGE SALE!!" })),
    ).toEqual(["subject-shouting", "subject-exclaim"]);
  });

  it("flags missing and over-long preview text", () => {
    expect(ids(computeChecklist({ email: email([text], ""), subject: "Hi" }))).toEqual([
      "preview-missing",
    ]);
    expect(
      ids(computeChecklist({ email: email([text], "p".repeat(111)), subject: "Hi" })),
    ).toEqual(["preview-long"]);
  });

  it("flags buttons without a link and puts must-fix items first", () => {
    const items = computeChecklist({
      email: email(
        [
          text,
          {
            blockType: "link",
            settings: { text: "Go", url: "https://", isButton: true },
          },
          { blockType: "image", settings: { src: "https://x/y.png" } },
        ],
        "",
      ),
      subject: "Hi",
    });
    expect(items.map((i) => [i.level, i.title])).toEqual([
      ["must", "Button “Go” has no link"],
      ["should", "Add preview text"],
      ["should", "Image has no alt text"],
    ]);
    expect(items[0].target).toEqual({ type: "block", blockId: "b1" });
  });

  it("flags empty social, image and conditional blocks and an empty email", () => {
    const items = computeChecklist({
      email: email([
        { blockType: "social", settings: { links: [] } },
        { blockType: "image", settings: { src: "" } },
        { blockType: "conditional", settings: { tag: "", content: "x" } },
      ]),
      subject: "Hi",
    });
    expect(ids(items).sort()).toEqual(
      ["empty", "image-b1", "social-b0", "tag-b2"].sort(),
    );
  });

  it("flags each ticked social network without an address as must-fix", () => {
    const items = computeChecklist({
      email: email([
        text,
        {
          blockType: "social",
          settings: {
            links: [
              { network: "x", url: "" },
              { network: "instagram", url: "https://instagram.com/a" },
            ],
          },
        },
      ]),
      subject: "Hi",
    });
    expect(items.map((i) => [i.level, i.title])).toEqual([
      ["must", "X link is missing"],
    ]);
  });

  it("accepts mailto and merge-tag links on buttons", () => {
    for (const url of ["mailto:a@b.co", "{{ event.url }}", "https://x.co/a"]) {
      const items = computeChecklist({
        email: email([text, { blockType: "link", settings: { text: "Go", url } }]),
        subject: "Hi",
      });
      expect(items).toEqual([]);
    }
  });

  it("offers a fallback for merge tags that can be blank, once per tag", () => {
    const items = computeChecklist({
      email: email([
        {
          blockType: "text",
          settings: { content: "Hi {{ subscriber.name }}, {{ subscriber.email }}" },
        },
        { blockType: "text", settings: { content: "Bye {{ subscriber.name }}" } },
        {
          blockType: "text",
          settings: { content: 'Plan {{ event.plan | default: "free" }}' },
        },
      ]),
      subject: "Hi",
    });
    expect(items.map((i) => [i.id, i.fallback?.path, i.target])).toEqual([
      ["fallback-subscriber.name", "subscriber.name", { type: "block", blockId: "b0" }],
    ]);
  });

  it("does not ask to write when the editor has no text block", () => {
    expect(
      ids(computeChecklist({ email: email([]), subject: "Hi", canWrite: false })),
    ).toEqual([]);
  });

  it("labels the button by what needs doing", () => {
    expect(checklistLabel([])).toBe("Ready to send");
    const must = computeChecklist({ email: email([text]), subject: "" });
    expect(checklistLabel(must)).toBe("1 to fix");
    const should = computeChecklist({ email: email([text], ""), subject: "Hi" });
    expect(checklistLabel(should)).toBe("1 to check");
  });

  it("quotes the start of the email the way an inbox shows it", () => {
    const items = computeChecklist({
      email: email(
        [
          {
            blockType: "text",
            settings: {
              content:
                '# Hi {{ subscriber.name | default: "there" }}, {{ event.plan }}',
            },
          },
        ],
        "",
      ),
      subject: "Hi",
    });
    expect(items[0].detail).toContain("“Hi there, {plan}");
  });
});
