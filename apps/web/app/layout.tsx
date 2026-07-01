import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "SendLit",
    description: "Compose, send and automate email.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body className="antialiased">{children}</body>
        </html>
    );
}
