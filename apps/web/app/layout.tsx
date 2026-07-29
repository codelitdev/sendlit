import type { Metadata } from "next";
import "./globals.css";
import { Hanken_Grotesk, Spline_Sans_Mono } from "next/font/google";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/codelit/tooltip";

const hankenGrotesk = Hanken_Grotesk({
    subsets: ["latin"],
    variable: "--font-sans",
});
const splineSansMono = Spline_Sans_Mono({
    subsets: ["latin"],
    variable: "--font-mono",
});

export const metadata: Metadata = {
    title: "SendLit",
    description: "Compose, send and automate email.",
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
            className={cn(
                "font-sans",
                hankenGrotesk.variable,
                splineSansMono.variable,
            )}
        >
            <body className="antialiased">
                <TooltipProvider>{children}</TooltipProvider>
            </body>
        </html>
    );
}
