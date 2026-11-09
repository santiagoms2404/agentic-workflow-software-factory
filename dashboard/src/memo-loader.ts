/**
 * A loader read once and reused: every caller shares one request, and a
 * resolved value is kept for the life of the page. A rejected request is not
 * kept. Memoizing the rejection too froze the dashboard: one failed settings
 * read at startup (the server restarting, a network blip) became the answer to
 * every later poll, so nothing refreshed until a reload. So the memo is dropped
 * when its request rejects, and the next call reads again.
 */
export function memoizeUntilRejected<T>(load: () => Promise<T>): () => Promise<T> {
  let request: Promise<T> | null = null;
  return () => {
    if (request !== null) return request;
    const current = load();
    request = current;
    current.catch(() => {
      // Only this request's own memo is cleared, never a newer one's.
      if (request === current) request = null;
    });
    return current;
  };
}
