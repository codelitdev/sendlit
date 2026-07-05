import { Mail, Send } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

const ERROR_MESSAGES: Record<string, string> = {
    invalid_state: "Your sign-in session expired. Please try again.",
    token_exchange_failed: "We couldn't complete sign-in. Please try again.",
    access_denied: "Sign-in was cancelled.",
};

export default async function LoginPage({
    searchParams,
}: {
    searchParams: Promise<{ error?: string }>;
}) {
    const { error } = await searchParams;

    return (
        <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
            <Card className="w-full max-w-sm">
                <CardHeader className="items-center text-center">
                    <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Send className="size-5" />
                    </div>
                    <CardTitle className="text-xl">
                        Sign in to SendLit
                    </CardTitle>
                    <CardDescription>
                        We&apos;ll email you a one-time code — no password
                        needed.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {error && (
                        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                            {ERROR_MESSAGES[error] ||
                                "Something went wrong. Please try again."}
                        </p>
                    )}
                    <Button asChild className="w-full">
                        <Link href="/api/auth/login">
                            <Mail className="size-4" />
                            Continue with email
                        </Link>
                    </Button>
                    <p className="text-center text-xs text-muted-foreground">
                        Authentication is handled by the SendLit API over OAuth2
                        (PKCE).
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
