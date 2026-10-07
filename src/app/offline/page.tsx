export const metadata = { title: "Offline · Patas" };

// Cached by public/sw.js and shown when a page load fails. Inline styles,
// because the stylesheet may not be cached.
export default function Offline() {
  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: "48px 16px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ color: "#1f6f50" }}>Patas</h1>
      <p>You're offline. Patas needs a connection to work out travel times.</p>
      <p>
        <a href="/" style={{ color: "#1f6f50" }}>
          Try again
        </a>
      </p>
    </main>
  );
}
