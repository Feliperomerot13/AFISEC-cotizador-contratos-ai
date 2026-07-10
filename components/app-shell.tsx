"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import {
  FileText,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import packageMetadata from "@/package.json";

type NavItem = {
  href: string;
  label: string;
  title: string;
  icon: LucideIcon;
  match: (pathname: string) => boolean;
};

const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Inicio",
    title: "Inicio",
    icon: LayoutDashboard,
    match: (pathname) => pathname === "/",
  },
  {
    href: "/upload",
    label: "Cargar",
    title: "Cargar documento",
    icon: Upload,
    match: (pathname) => pathname.startsWith("/upload"),
  },
  {
    href: "/contratos",
    label: "Contratos",
    title: "Contratos",
    icon: FileText,
    match: (pathname) => pathname.startsWith("/contratos"),
  },
];

const COLLAPSE_STORAGE_KEY = "afisec-sidebar-collapsed";

let collapsedValue = false;
let collapsedInitialized = false;
const collapsedListeners = new Set<() => void>();

function subscribeCollapsed(callback: () => void) {
  collapsedListeners.add(callback);
  return () => {
    collapsedListeners.delete(callback);
  };
}

function getCollapsedSnapshot() {
  if (!collapsedInitialized && typeof window !== "undefined") {
    collapsedValue =
      window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1";
    collapsedInitialized = true;
  }
  return collapsedValue;
}

function getCollapsedServerSnapshot() {
  return false;
}

function setCollapsedStore(next: boolean) {
  collapsedValue = next;
  collapsedInitialized = true;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
  }
  collapsedListeners.forEach((listener) => listener());
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    getCollapsedSnapshot,
    getCollapsedServerSnapshot,
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  function toggleCollapsed() {
    setCollapsedStore(!collapsed);
  }

  const activeItem =
    NAV_ITEMS.find((item) => item.match(pathname)) ?? NAV_ITEMS[0];
  const sectionTitle = pathname.startsWith("/contratos/")
    ? "Detalle de contrato"
    : activeItem.title;

  return (
    <div className="min-h-screen lg:flex">
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Cerrar menú"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-neutral-950/40 backdrop-blur-sm lg:hidden"
        />
      ) : null}

      <Sidebar
        pathname={pathname}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onToggleCollapsed={toggleCollapsed}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <Topbar
          title={sectionTitle}
          onOpenMobile={() => setMobileOpen(true)}
        />
        <main className="app-scroll mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function Sidebar({
  pathname,
  collapsed,
  mobileOpen,
  onToggleCollapsed,
  onCloseMobile,
}: {
  pathname: string;
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapsed: () => void;
  onCloseMobile: () => void;
}) {
  return (
    <aside
      className={[
        "fixed inset-y-0 left-0 z-40 flex h-full flex-col border-r border-[var(--border)] bg-[var(--surface)] transition-transform duration-300 lg:static lg:z-auto lg:translate-x-0",
        collapsed ? "w-64 lg:w-[76px]" : "w-64",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
      ].join(" ")}
    >
      <div className="flex h-16 items-center gap-3 border-b border-[var(--border)] px-4">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-3 rounded-lg outline-none focus-visible:ring-4 focus-visible:ring-[#d25b30]/20"
        >
          <Image
            src="/brand/Logo_Color_Afisec_cuadrado.png"
            alt="AFISEC"
            width={36}
            height={42}
            className="h-9 w-auto shrink-0"
            priority
          />
          {!collapsed ? (
            <span className="min-w-0">
              <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-[#d25b30]">
                AFISEC
              </span>
              <span className="block truncate text-sm font-semibold text-[var(--foreground-strong)]">
                Cotizaciones
              </span>
            </span>
          ) : null}
        </Link>
        <button
          type="button"
          aria-label="Cerrar menú"
          onClick={onCloseMobile}
          className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 lg:hidden"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <nav className="app-scroll flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const isActive = item.match(pathname);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onCloseMobile}
              aria-current={isActive ? "page" : undefined}
              title={collapsed ? item.title : undefined}
              className={[
                "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium outline-none transition focus-visible:ring-4 focus-visible:ring-[#d25b30]/20",
                collapsed ? "lg:justify-center lg:px-0" : "",
                isActive
                  ? "bg-[#d25b30]/10 text-[#b94d28]"
                  : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900",
              ].join(" ")}
            >
              {isActive ? (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-[#d25b30]"
                />
              ) : null}
              <Icon
                className={[
                  "h-5 w-5 shrink-0",
                  isActive
                    ? "text-[#d25b30]"
                    : "text-neutral-400 group-hover:text-neutral-600",
                ].join(" ")}
                aria-hidden
              />
              <span className={collapsed ? "lg:hidden" : ""}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-[var(--border)] px-3 py-3">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
          className={[
            "hidden w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 lg:flex",
            collapsed ? "lg:justify-center lg:px-0" : "",
          ].join(" ")}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-5 w-5 shrink-0" aria-hidden />
          ) : (
            <>
              <PanelLeftClose className="h-5 w-5 shrink-0" aria-hidden />
              <span>Colapsar</span>
            </>
          )}
        </button>

        <div
          className={[
            "mt-2 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500",
            collapsed ? "lg:hidden" : "",
          ].join(" ")}
        >
          <p className="font-semibold text-neutral-700">
            v{packageMetadata.version}
          </p>
        </div>
      </div>
    </aside>
  );
}

function Topbar({
  title,
  onOpenMobile,
}: {
  title: string;
  onOpenMobile: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)]/85 px-4 backdrop-blur sm:px-6 lg:px-8">
      <button
        type="button"
        aria-label="Abrir menú"
        onClick={onOpenMobile}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 lg:hidden"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>
      <h1 className="truncate text-base font-semibold text-[var(--foreground-strong)]">
        {title}
      </h1>
      <span className="ml-auto hidden items-center gap-2 rounded-full border border-[var(--border)] bg-neutral-50 px-3 py-1 text-xs font-medium text-neutral-500 sm:inline-flex">
        v{packageMetadata.version}
      </span>
    </header>
  );
}
