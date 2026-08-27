// @vitest-environment jsdom

import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
    MAILING_ADDRESS_REQUIRED_ERROR,
    SendErrorMessage,
} from "./send-error-message";

describe("SendErrorMessage", () => {
    afterEach(cleanup);
    it("links mailing-address errors to Settings", () => {
        render(<SendErrorMessage error={MAILING_ADDRESS_REQUIRED_ERROR} />);
        const link = screen.getByRole("link", { name: "Settings" });
        expect(link.getAttribute("href")).toBe("/settings");
        expect(screen.getByText(/mailing address is required/i)).toBeTruthy();
    });

    it("passes through other errors unchanged", () => {
        render(<SendErrorMessage error="Team ESP is not configured." />);
        expect(screen.getByText("Team ESP is not configured.")).toBeTruthy();
        expect(screen.queryByRole("link")).toBeNull();
    });

    it("maps delivery-source codes to human-facing copy", () => {
        render(<SendErrorMessage error="delivery_source_unavailable" />);
        expect(
            screen.getByText(/No active delivery source is configured/i),
        ).toBeTruthy();
    });
});
