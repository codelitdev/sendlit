import { ShieldCheck } from "lucide-react";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { requireAuth } from "@/lib/server-auth";
import { ConsentForm } from "./consent-form";

export default async function OAuthConsentPage() {
    await requireAuth();

    return (
        <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
            <Card className="w-full max-w-md">
                <CardHeader className="items-center text-center">
                    <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <ShieldCheck className="size-5" />
                    </div>
                    <CardTitle className="text-xl">
                        Authorize SendLit access
                    </CardTitle>
                    <CardDescription>
                        Review the client and scopes before continuing.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ConsentForm />
                </CardContent>
            </Card>
        </div>
    );
}
