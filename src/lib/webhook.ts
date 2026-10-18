/**
 * Post a message to a Discord channel webhook. Throws on a network error,
 * after 3 s, or on a non-2xx answer (a deleted webhook, a 429), without
 * echoing the response body. `allowed_mentions` is empty, so text from users
 * can't @mention anyone.
 */
export async function postWebhook(url: string, content: string): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`webhook ${res.status}`);
}
