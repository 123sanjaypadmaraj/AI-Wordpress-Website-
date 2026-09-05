import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI WordPress Builder",
  description: "Conversational AI website builder that operates real WordPress via Docker.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans text-ink antialiased">
        <div className="flex min-h-screen flex-col">
          <header className="border-b border-border bg-surface">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
              <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-xs font-bold text-white">
                  AI
                </span>
                WordPress Builder
              </Link>
              <nav className="text-sm text-ink-muted">
                <Link href="/" className="hover:text-ink">Dashboard</Link>
              </nav>
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
