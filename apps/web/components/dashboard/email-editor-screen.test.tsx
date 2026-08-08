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
    editorProps: null as any,
    getGeneralSettings: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ back: mocks.back, push: mocks.push }),
}));
vi.mock("@sendlit/email-blocks", () => ({
    EmailEditor: (props: { onChange: (content: any) => void }) => {
        mocks.editorProps = props;
        return (
            <button onClick={() => props.onChange(mocks.changedContent)}>
                Change document
            </button>
        );
    },
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
vi.mock("@/lib/api", () => ({
    getGeneralSettings: mocks.getGeneralSettings,
}));

import { EmailEditorScreen } from "./email-editor-screen";

const initialContent = {
    content: [],
    style: { marker: "initial" },
    meta: {},
} as any;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.editorProps = null;
    mocks.getGeneralSettings.mockResolvedValue({
        mailingAddress: "123 Main Street",
    });
});

afterEach(() => cleanup());

describe("EmailEditorScreen", () => {
    it("saves the latest editor document rather than the initial prop", async () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        render(
            <EmailEditorScreen
                exitFallbackHref="/templates"
                purpose="transactional"
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
                purpose="transactional"
                initialContent={initialContent}
                onSave={onSave}
            />,
        );

        const save = screen.getByRole("button", { name: "Save" });
        fireEvent.click(save);

        // Loader adds aria-label "Loading", so the accessible name is "Loading Saving…"
        const savingButton = screen.getByRole("button", {
            name: /Saving…/,
        }) as HTMLButtonElement;
        expect(savingButton.disabled).toBe(true);
        fireEvent.click(savingButton);
        expect(onSave).toHaveBeenCalledOnce();
        finish();
        await screen.findByText("Saved");
    });

    it("shows API errors and re-enables saving", async () => {
        const onSave = vi.fn().mockRejectedValue(new ApiError(409, "Conflict"));
        render(
            <EmailEditorScreen
                exitFallbackHref="/templates"
                purpose="transactional"
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
                purpose="transactional"
                initialContent={initialContent}
                onSave={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "Exit editor" }));

        expect(mocks.push).toHaveBeenCalledWith("/templates");
        expect(mocks.back).not.toHaveBeenCalled();
    });

    it("registers the locked footer and server-owned preview context only for marketing", async () => {
        render(
            <EmailEditorScreen
                exitFallbackHref="/templates"
                purpose="marketing"
                initialContent={initialContent}
                onSave={vi.fn()}
            />,
        );

        expect(screen.getByText("marketing")).toBeTruthy();
        await waitFor(() =>
            expect(mocks.editorProps.renderContext).toEqual({
                footer: {
                    mailingAddress: "123 Main Street",
                    unsubscribeUrl: "#unsubscribe-preview",
                },
            }),
        );
        expect(
            mocks.editorProps.blocks.some(
                (block: any) =>
                    block.metadata?.name === "footer" &&
                    block.capabilities?.placement === "last" &&
                    block.capabilities?.deletable === false,
            ),
        ).toBe(true);
        expect(screen.getByText("{{ subscriber.email }}")).toBeTruthy();
        expect(screen.getByText("{{ subscriber.tags }}")).toBeTruthy();
        expect(screen.queryByText("{{ address }}")).toBeNull();
    });

    it("keeps transactional editing footer-free and exposes required business variables", () => {
        render(
            <EmailEditorScreen
                exitFallbackHref="/templates"
                purpose="transactional"
                requiredVariables={["customer.name", "otp"]}
                initialContent={initialContent}
                onSave={vi.fn()}
            />,
        );

        expect(
            mocks.editorProps.blocks.some(
                (block: any) => block.metadata?.name === "footer",
            ),
        ).toBe(false);
        expect(mocks.editorProps.renderContext).toBeUndefined();
        expect(screen.getByText("{{ customer.name }}")).toBeTruthy();
        expect(screen.getByText("{{ otp }}")).toBeTruthy();
        expect(screen.queryByText("{{ subscriber.email }}")).toBeNull();
    });

    it("does not expose template duplication from the editor", async () => {
        render(
            <EmailEditorScreen
                exitFallbackHref="/templates"
                purpose="transactional"
                initialContent={initialContent}
                onSave={vi.fn()}
            />,
        );

        expect(screen.queryByText(/Duplicate/)).toBeNull();
    });
});
