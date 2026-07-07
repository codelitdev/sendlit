"use client";

import { FormEvent, useState } from "react";
import { Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Step = "email" | "otp";

async function postJson(path: string, body: Record<string, unknown>) {
    const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data?.message || data?.error || "Request failed");
    }
    return data;
}

export function LoginForm() {
    const [step, setStep] = useState<Step>("email");
    const [email, setEmail] = useState("");
    const [otp, setOtp] = useState("");
    const [error, setError] = useState("");
    const [pending, setPending] = useState(false);

    async function sendOtp(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        setPending(true);
        try {
            await postJson("/api/auth/email-otp/send-verification-otp", {
                email,
                type: "sign-in",
            });
            setStep("otp");
        } catch (err: any) {
            setError(err.message || "Could not send the code.");
        } finally {
            setPending(false);
        }
    }

    async function verifyOtp(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        setPending(true);
        try {
            await postJson("/api/auth/sign-in/email-otp", {
                email,
                otp,
                name: email.split("@")[0],
            });
            window.location.assign("/dashboard");
        } catch (err: any) {
            setError(err.message || "The code is invalid or expired.");
        } finally {
            setPending(false);
        }
    }

    async function signInWithGoogle() {
        setError("");
        setPending(true);
        try {
            const data = await postJson("/api/auth/sign-in/social", {
                provider: "google",
                callbackURL: "/dashboard",
                errorCallbackURL: "/login?error=oauth_failed",
            });
            if (data.url) {
                window.location.assign(data.url);
                return;
            }
            throw new Error("Google sign-in is not configured.");
        } catch (err: any) {
            setError(err.message || "Could not start Google sign-in.");
            setPending(false);
        }
    }

    return (
        <div className="space-y-4">
            {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                </p>
            )}

            {step === "email" ? (
                <form className="space-y-3" onSubmit={sendOtp}>
                    <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            required
                            autoComplete="email"
                            placeholder="you@example.com"
                        />
                    </div>
                    <Button className="w-full" disabled={pending}>
                        <Mail className="size-4" />
                        {pending ? "Sending..." : "Continue with email"}
                    </Button>
                </form>
            ) : (
                <form className="space-y-3" onSubmit={verifyOtp}>
                    <div className="space-y-2">
                        <Label htmlFor="otp">Verification code</Label>
                        <Input
                            id="otp"
                            inputMode="numeric"
                            value={otp}
                            onChange={(event) => setOtp(event.target.value)}
                            required
                            autoComplete="one-time-code"
                            placeholder="123456"
                        />
                    </div>
                    <Button className="w-full" disabled={pending}>
                        <ShieldCheck className="size-4" />
                        {pending ? "Verifying..." : "Sign in"}
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        className="w-full"
                        onClick={() => setStep("email")}
                        disabled={pending}
                    >
                        Use a different email
                    </Button>
                </form>
            )}

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                <span>or</span>
                <div className="h-px flex-1 bg-border" />
            </div>

            <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={signInWithGoogle}
                disabled={pending}
            >
                Continue with Google
            </Button>
        </div>
    );
}
