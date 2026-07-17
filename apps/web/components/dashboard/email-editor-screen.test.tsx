// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { ApiError } from "@/lib/api-client";

const mocks = vi.hoisted(() => ({
    back: vi.fn(),
    push: vi.fn(),
    changedContent: {
        content: [{ blockType: "text", settings: { content: "Edited" } }],
        style: { marker: "edited" },
        meta: {},
    },
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ back: mocks.back, push: mocks.push }),
}));
vi.mock("@sendlit/email-blocks", () => ({
    EmailEditor: ({ onChange }: { onChange: (content: any) => void }) => (
        <button onClick={() => onChange(mocks.changedContent)}>
            Change document
        </button>
    ),
}));
vi.mock("@sendlit/email-editor/blocks", () => ({
    Text: {},
    Separator: {},
    Link: {},
    ImageBlock: { configure: () => ({}) },
}));
vi.mock("@/components/dashboard/email-image-upload-dialog", () => ({
    EmailImageUploadDialog: ({ children }: { children: React.ReactNode }) => (
        <>{children}</>
    ),
}));

import { EmailEditorScreen } from "./email-editor-screen";

const initialContent = {
    content: [],
    style: { marker: "initial" },
    meta: {},
} as any;

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => cleanup());

describe("EmailEditorScreen", () => {
    it("saves the latest editor document rather than the initial prop", async () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        render(
            <EmailEditorScreen
                exitFallbackHref="/templates"
                initialContent={initialContent}
                onSave={onSave}
            />,
        );

        fireEvent.click(screen.getByText("Change document"));
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() =>
            expect(onSave).toHaveBeenCalledWith(mocks.changedContent),
        );
        expect(await screen.findByText("Saved")).toBeTruthy();
    });

    it("disables duplicate saves while persistence is in flight", async () => {
        let finish!: () => void;
        const onSave = vi.fn(
            () => new Promise<void>((resolve) => (finish = resolve)),
        );
        render(
            <EmailEditorScreen
                exitFallbackHref="/templates"
                initialContent={initialContent}
                onSave={onSave}
            />,
        );

        const save = screen.getByRole("button", { name: "Save" });
        fireEvent.click(save);

        expect(
            (
                screen.getByRole("button", {
                    name: "Saving…",
                }) as HTMLButtonElement
            ).disabled,
        ).toBe(true);
        fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
        expect(onSave).toHaveBeenCalledOnce();
        finish();
        await screen.findByText("Saved");
    });

    it("shows API errors and re-enables saving", async () => {
        const onSave = vi.fn().mockRejectedValue(new ApiError(409, "Conflict"));
        render(
            <EmailEditorScreen
                exitFallbackHref="/templates"
                initialContent={initialContent}
                onSave={onSave}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        expect(await screen.findByText("Conflict")).toBeTruthy();
        expect(
            (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
                .disabled,
        ).toBe(false);
    });

    it("uses the fallback route for a deep-linked editor", () => {
        Object.defineProperty(window.history, "length", {
            configurable: true,
            value: 1,
        });
        render(
            <EmailEditorScreen
                exitFallbackHref="/templates"
                initialContent={initialContent}
                onSave={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "Exit editor" }));

        expect(mocks.push).toHaveBeenCalledWith("/templates");
        expect(mocks.back).not.toHaveBeenCalled();
    });
});
