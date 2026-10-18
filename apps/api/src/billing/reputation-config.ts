export type ReputationConfig = {
    minimumAccepted: number;
    bounceWarnBps: number;
    complaintWarnBps: number;
    bouncePauseBps: number;
    complaintPauseBps: number;
    complaintStopBps: number;
    complaintStopAbsolute: number;
    transactionalDailyLimit: number;
    minimumHoldHours: number;
    recoveryCleanDays: number;
};

function positiveInt(
    name: string,
    fallback: number,
    max = 2_147_483_647,
): number {
    const raw = process.env[name];
    if (raw === undefined || raw === "") return fallback;
    if (!/^\d+$/.test(raw)) throw new Error(`${name}_invalid`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0 || value > max)
        throw new Error(`${name}_invalid`);
    return value;
}

/** Fair-use thresholds are deployment configuration, not route constants. */
export function readReputationConfig(): ReputationConfig {
    return {
        minimumAccepted: positiveInt("BILLING_FAIR_USE_MIN_ACCEPTED", 500),
        bounceWarnBps: positiveInt("BILLING_FAIR_USE_BOUNCE_WARN_BPS", 200),
        complaintWarnBps: positiveInt("BILLING_FAIR_USE_COMPLAINT_WARN_BPS", 5),
        bouncePauseBps: positiveInt("BILLING_FAIR_USE_BOUNCE_PAUSE_BPS", 500),
        complaintPauseBps: positiveInt(
            "BILLING_FAIR_USE_COMPLAINT_PAUSE_BPS",
            10,
        ),
        complaintStopBps: positiveInt(
            "BILLING_FAIR_USE_COMPLAINT_STOP_BPS",
            30,
        ),
        complaintStopAbsolute: positiveInt(
            "BILLING_FAIR_USE_COMPLAINT_STOP_ABSOLUTE",
            10,
        ),
        transactionalDailyLimit: positiveInt(
            "BILLING_FAIR_USE_TRANSACTIONAL_DAILY_LIMIT",
            100,
        ),
        minimumHoldHours: positiveInt(
            "BILLING_FAIR_USE_MINIMUM_HOLD_HOURS",
            72,
        ),
        recoveryCleanDays: positiveInt(
            "BILLING_FAIR_USE_RECOVERY_CLEAN_DAYS",
            7,
        ),
    };
}
