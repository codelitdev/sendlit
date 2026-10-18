export type PlanGateCode =
    | "plan_feature_unavailable"
    | "plan_limit_reached"
    | "payment_required"
    | "sending_paused"
    | "domain_verification_required";

export class PlanGateError extends Error {
    readonly status: 402 | 403 | 409;
    constructor(
        public readonly code: PlanGateCode,
        public readonly details: Record<string, unknown> = {},
    ) {
        const organizationId = details.organizationId;
        if (
            typeof organizationId === "string" &&
            !details.upgradeUrl &&
            process.env.WEB_CLIENT
        ) {
            try {
                details.upgradeUrl = `${new URL(process.env.WEB_CLIENT).origin}/organizations?tab=plan&organization=${encodeURIComponent(organizationId)}`;
            } catch {
                // Invalid public URL is reported by startup configuration
                // validation; never let it break an otherwise safe denial.
            }
        }
        super(code);
        this.name = "PlanGateError";
        this.status =
            code === "payment_required"
                ? 402
                : code === "plan_limit_reached"
                  ? 409
                  : 403;
    }
}

export function isPlanGateError(error: unknown): error is PlanGateError {
    return (
        error instanceof PlanGateError ||
        Boolean(
            error &&
            typeof error === "object" &&
            (error as any).name === "PlanGateError",
        )
    );
}

export function planGateHttp(error: unknown): {
    status: 402 | 403 | 409;
    body: Record<string, unknown>;
} | null {
    if (!isPlanGateError(error)) return null;
    return {
        status: error.status,
        body: { error: error.code, ...error.details },
    };
}
