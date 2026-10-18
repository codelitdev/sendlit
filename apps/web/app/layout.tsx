import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Hanken_Grotesk, Spline_Sans_Mono } from "next/font/google";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/codelit/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { getPosthogBrowserConfig } from "@/lib/config";
import { PostHogProvider } from "@/components/posthog-provider";

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

export default async function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // Request-time read so POSTHOG_* can change at container start. Static
    // generation would freeze the build-time (usually empty) value into the
    // OSS image.
    await headers();
    const posthog = getPosthogBrowserConfig();
    const content = (
        <TooltipProvider>
            {children}
            <Toaster />
        </TooltipProvider>
    );

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
                {posthog ? (
                    <PostHogProvider
                        apiKey={posthog.apiKey}
                        host={posthog.host}
                        environment={posthog.environment}
                    >
                        {content}
                    </PostHogProvider>
                ) : (
                    content
                )}
            </body>
        </html>
    );
}
