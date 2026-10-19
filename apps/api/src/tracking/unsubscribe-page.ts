import { escapeHtml } from "../utils/html";

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f6f7;color:#18181b}main{max-width:28rem;margin:15vh auto;padding:2rem;background:#fff;border:1px solid #e4e4e7;border-radius:.75rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .75rem}p{margin:0 0 1.5rem;line-height:1.5;color:#52525b}button{font:inherit;padding:.625rem 1.25rem;border:0;border-radius:.5rem;background:#18181b;color:#fff;cursor:pointer}</style></head><body><main>${body}</main></body></html>`;
}

/** Shown on GET. The form posts back to the same URL (no `action`), so it
 * keeps working behind any path-rewriting proxy in front of the API. */
export function unsubscribeConfirmPage(email: string) {
  return page(
    "Unsubscribe",
    `<h1>Unsubscribe?</h1><p><strong>${escapeHtml(email)}</strong> will stop receiving these emails.</p><form method="post"><input type="hidden" name="source" value="page"><button type="submit">Unsubscribe</button></form>`,
  );
}

export function unsubscribedPage(email: string) {
  return page(
    "Unsubscribed",
    `<h1>You have been unsubscribed</h1><p><strong>${escapeHtml(email)}</strong> will no longer receive these emails.</p>`,
  );
}

export function invalidUnsubscribeLinkPage() {
  return page(
    "Invalid unsubscribe link",
    `<h1>Invalid unsubscribe link</h1><p>This link is not valid. Reply to the email you received to ask the sender to unsubscribe you.</p>`,
  );
}

export function testUnsubscribePage() {
  return page(
    "Test email",
    `<h1>This was a test email</h1><p>Unsubscribe links in test emails don't change anything. Your recipients get a working link.</p>`,
  );
}
