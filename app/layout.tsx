import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Muñeco Digital | AFISEC",
  description: "Prelectura inteligente de contratos para AFISEC.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>
        <header className="border-b border-neutral-200 bg-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
            <Link href="/" className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-700 text-sm font-bold text-white">
                MD
              </span>
              <span>
                <span className="block text-sm font-semibold uppercase tracking-[0.18em] text-neutral-500">
                  AFISEC
                </span>
                <span className="block text-lg font-semibold text-neutral-950">
                  Muñeco Digital
                </span>
              </span>
            </Link>
            <nav className="flex flex-wrap gap-2 text-sm font-semibold">
              <Link
                href="/"
                className="rounded-lg px-3 py-2 text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-950"
              >
                Inicio
              </Link>
              <Link
                href="/upload"
                className="rounded-lg px-3 py-2 text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-950"
              >
                Cargar
              </Link>
              <Link
                href="/contratos"
                className="rounded-lg px-3 py-2 text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-950"
              >
                Contratos
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </main>
      </body>
    </html>
  );
}
