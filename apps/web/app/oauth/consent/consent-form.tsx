"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";

async function submitConsent(accept: boolean, oauthQuery: string) {
    const res = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            accept,
            oauth_query: oauthQuery,
        }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data?.message || data?.error || "Consent failed");
    }
    return data as { redirect_uri: string };
}

export function ConsentForm() {
    const searchParams = useSearchParams();
    const [pending, setPending] = useState<"accept" | "deny" | null>(null);
    const [error, setError] = useState("");
    const clientId = searchParams.get("client_id") || "OAuth client";
    const scope = searchParams.get("scope") || "";
    const scopes = scope.split(/\s+/).filter(Boolean);
    const oauthQuery = searchParams.toString();

    async function decide(accept: boolean) {
        setError("");
        setPending(accept ? "accept" : "deny");
        try {
            const data = await submitConsent(accept, oauthQuery);
            window.location.assign(data.redirect_uri);
        } catch (err: any) {
            setError(err.message || "Could not complete authorization.");
            setPending(null);
        }
    }

    return (
        <div className="space-y-4">
            {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                </p>
            )}
            <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-sm font-medium">{clientId}</p>
                {scopes.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                        {scopes.map((item) => (
                            <span
                                key={item}
                                className="rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground"
                            >
                                {item}
                            </span>
                        ))}
                    </div>
                )}
            </div>
            <div className="flex gap-2">
                <Button
                    className="flex-1"
                    disabled={pending !== null}
                    onClick={() => decide(true)}
                >
                    <Check className="size-4" />
                    {pending === "accept" ? "Authorizing..." : "Allow"}
                </Button>
                <Button
                    className="flex-1"
                    variant="outline"
                    disabled={pending !== null}
                    onClick={() => decide(false)}
                >
                    <X className="size-4" />
                    Deny
                </Button>
            </div>
        </div>
    );
}
