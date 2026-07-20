"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html>
      <body style={{ margin: 0, background: "#0B0B0B", color: "#D1D5DB", fontFamily: "sans-serif", display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <h1 style={{ fontSize: "1.5rem", color: "#F59E0B", marginBottom: "1rem" }}>Something went wrong</h1>
          <p style={{ marginBottom: "1.5rem" }}>An unexpected error occurred. Please try again.</p>
          <button
            onClick={reset}
            style={{ background: "#F59E0B", color: "#000", border: "none", borderRadius: "0.5rem", padding: "0.5rem 1.5rem", cursor: "pointer", fontWeight: 600 }}
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
