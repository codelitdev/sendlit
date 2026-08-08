import type { Metadata } from "next";
import "./global.css";
import { Hanken_Grotesk, Spline_Sans_Mono } from "next/font/google";
import { DocsProvider } from "@/components/docs-provider";

const hankenGrotesk = Hanken_Grotesk({
    subsets: ["latin"],
    variable: "--font-sans",
});
const splineSansMono = Spline_Sans_Mono({
    subsets: ["latin"],
    variable: "--font-mono",
});

export const metadata: Metadata = {
    title: {
        default: "SendLit Docs",
        template: "%s | SendLit Docs",
    },
    description:
        "Documentation for SendLit email marketing, automation, APIs, and email blocks.",
    icons: {
        icon: "/icon.svg",
    },
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html
            lang="en"
            data-product="sendlit"
            className={`font-sans ${hankenGrotesk.variable} ${splineSansMono.variable}`}
            suppressHydrationWarning
        >
            <body className="antialiased">
                <DocsProvider>{children}</DocsProvider>
            </body>
        </html>
    );
}
