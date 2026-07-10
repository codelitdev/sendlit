type LoginUrlInput = {
    apiPublicUrl: string;
    webClient: string;
};

export function getDashboardLoginUrl({
    apiPublicUrl,
    webClient,
}: LoginUrlInput): string {
    return `${apiPublicUrl}/login?redirect=${encodeURIComponent(`${webClient}/dashboard`)}`;
}
