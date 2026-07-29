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

const mocks = vi.hoisted(() => ({
    push: vi.fn(),
    listTemplates: vi.fn(),
    listSystemTemplates: vi.fn(),
    duplicateTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    previewProps: [] as any[],
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/lib/api", () => ({
    listTemplates: mocks.listTemplates,
    listSystemTemplates: mocks.listSystemTemplates,
    duplicateTemplate: mocks.duplicateTemplate,
    deleteTemplate: mocks.deleteTemplate,
}));
vi.mock("@sendlit/email-blocks", () => ({
    EmailPreview: (props: any) => {
        mocks.previewProps.push(props);
        return <div data-testid="email-preview" />;
    },
    TemplateChooser: () => <div data-testid="template-chooser" />,
    EmailEditor: () => null,
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
vi.mock("@/components/dashboard/delete-confirmation-dialog", () => ({
    DeleteConfirmationDialog: () => null,
}));
vi.mock("@/components/ui/codelit/tabs", async () => {
    const ReactModule = await import("react");
    const ChangeContext = ReactModule.createContext<(value: string) => void>(
        () => undefined,
    );
    return {
        Tabs: ({
            children,
            onValueChange,
        }: {
            children: React.ReactNode;
            onValueChange: (value: string) => void;
        }) => (
            <ChangeContext.Provider value={onValueChange}>
                <div>{children}</div>
            </ChangeContext.Provider>
        ),
        TabsList: ({ children }: { children: React.ReactNode }) => (
            <div role="tablist">{children}</div>
        ),
        TabsTrigger: ({
            children,
            value,
        }: {
            children: React.ReactNode;
            value: string;
        }) => {
            const onValueChange = ReactModule.useContext(ChangeContext);
            return (
                <button role="tab" onClick={() => onValueChange(value)}>
                    {children}
                </button>
            );
        },
    };
});
import TemplatesPage from "./page";
import { TooltipProvider } from "@/components/ui/codelit/tooltip";

const content = { style: {}, meta: {}, content: [] };
const templates = [
    {
        templateId: "tpl_marketing",
        title: "Newsletter",
        purpose: "marketing",
        content,
        requiredVariables: [],
        createdAt: "2026-07-25T00:00:00.000Z",
        updatedAt: "2026-07-25T00:00:00.000Z",
    },
    {
        templateId: "tpl_transactional",
        title: "Order receipt",
        purpose: "transactional",
        content,
        requiredVariables: ["customer.name", "order.id"],
        createdAt: "2026-07-25T00:00:00.000Z",
        updatedAt: "2026-07-25T00:00:00.000Z",
    },
];

beforeEach(() => {
    vi.clearAllMocks();
    mocks.previewProps = [];
    mocks.listTemplates.mockResolvedValue(templates);
    mocks.listSystemTemplates.mockResolvedValue([]);
});

afterEach(() => cleanup());

function renderPage() {
    return render(
        <TooltipProvider>
            <TemplatesPage />
        </TooltipProvider>,
    );
}

describe("template hub purposes", () => {
    it("renders purpose badges and filters incompatible cards", async () => {
        renderPage();

        expect(await screen.findByText("Newsletter")).toBeTruthy();
        expect(screen.getByText("Order receipt")).toBeTruthy();
        expect(screen.getAllByText("marketing")).toHaveLength(1);
        expect(screen.getAllByText("transactional")).toHaveLength(1);
        expect(
            mocks.previewProps.some(
                ({ blocks, renderContext }) => blocks && renderContext,
            ),
        ).toBe(true);
        expect(
            mocks.previewProps.some(
                ({ blocks, renderContext }) => !blocks && !renderContext,
            ),
        ).toBe(true);
        expect(
            screen.getAllByRole("button", { name: "Copy template ID" }),
        ).toHaveLength(2);
        expect(screen.queryByText("tpl_marketing")).toBeNull();
        expect(screen.queryByText("tpl_transactional")).toBeNull();

        fireEvent.click(screen.getByRole("tab", { name: "Transactional" }));

        await waitFor(() =>
            expect(screen.queryByText("Newsletter")).toBeNull(),
        );
        expect(screen.getByText("Order receipt")).toBeTruthy();
    });

    it("does not expose API usage from transactional template cards", async () => {
        renderPage();
        await screen.findByText("Order receipt");

        expect(
            screen.queryByRole("button", { name: "View API usage" }),
        ).toBeNull();
        expect(screen.queryByText("JSON request body")).toBeNull();
    });

    it("duplicates a template with its existing purpose from the card", async () => {
        mocks.duplicateTemplate.mockResolvedValue({
            ...templates[0],
            templateId: "tpl_marketing_copy",
        });
        renderPage();
        await screen.findByText("Newsletter");

        fireEvent.click(
            screen.getAllByRole("button", { name: "Duplicate template" })[0],
        );

        await waitFor(() =>
            expect(mocks.duplicateTemplate).toHaveBeenCalledWith(
                "tpl_marketing",
            ),
        );
        expect(mocks.push).not.toHaveBeenCalled();
        expect(screen.getByText("Newsletter")).toBeTruthy();
    });

    it("keeps a retired template visible for deletion without opening or previewing it", async () => {
        mocks.listTemplates.mockResolvedValue([
            {
                ...templates[0],
                templateId: "tpl_legacy",
                title: "Legacy campaign",
                validationError: "footer_required",
            },
        ]);
        renderPage();

        const warning = await screen.findByText(
            /This template uses a retired format/i,
        );
        expect(screen.getByText("Needs reset: footer_required")).toBeTruthy();
        expect(mocks.previewProps).toHaveLength(0);

        fireEvent.click(warning);
        expect(mocks.push).not.toHaveBeenCalled();
        expect(
            screen.getByRole("button", { name: "Delete template" }),
        ).toBeTruthy();
    });
});
