import type { Metadata } from "next";
import "./global.css";
import { DocsProvider } from "@/components/docs-provider";

export const metadata: Metadata = {
    title: {
        default: "SendLit Docs",
        template: "%s | SendLit Docs",
    },
    description:
        "Documentation for SendLit email marketing, automation, APIs, and email blocks.",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body>
                <DocsProvider>{children}</DocsProvider>
            </body>
        </html>
    );
}
