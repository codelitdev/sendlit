export function getEmailFrom({ name, email }: { name: string; email: string }) {
    return `${name} <${email}>`;
}

export function getSiteUrl(): string {
    return `${process.env.PROTOCOL || "https"}://${process.env.DOMAIN || "localhost"}`;
}

export function getUnsubLink(unsubscribeToken: string): string {
    return `${getSiteUrl()}/unsubscribe/${unsubscribeToken}`;
}
