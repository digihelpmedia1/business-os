"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3, Bell, BrainCircuit, ChevronDown, CircleCheck, FileText, FolderLock, KanbanSquare, Landmark,
  LayoutDashboard, Package, PanelLeftClose, PanelLeftOpen, Settings, ShieldCheck, Sparkles, Target, Truck, Users, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { can, type AccessMap } from "@/lib/permissions";
import { NAV } from "./nav";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, CircleCheck, FileText, Landmark, KanbanSquare, BrainCircuit, Truck, Package, Target, Users,
  BarChart3, FolderLock, Sparkles, Bell, Settings, ShieldCheck,
};

export function Sidebar({
  access,
  hasEmployee,
  mobileOpen,
  onMobileClose,
  unread,
}: {
  access: AccessMap;
  hasEmployee: boolean;
  mobileOpen: boolean;
  onMobileClose: () => void;
  unread: number;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("dhm-sidebar") === "collapsed");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("dhm-sidebar", c ? "open" : "collapsed");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  const groups = NAV.filter((g) => {
    if (g.key === "my-work") return hasEmployee || !can(access, "dashboard");
    return g.module === null || can(access, g.module);
  });

  const isActive = (href: string) => (href === "/projects" ? pathname === href || /^\/projects\/(?!tasks|calendar|time)[^/]+/.test(pathname) : pathname === href || pathname.startsWith(href + "/"));

  const content = (isMobile: boolean) => {
    const narrow = collapsed && !isMobile;
    return (
      <div className="flex h-full flex-col">
        <div className={cn("flex h-16 shrink-0 items-center border-b border-line", narrow ? "justify-center px-2" : "justify-between px-4")}>
          <Link href="/" className="flex items-center gap-2.5" onClick={onMobileClose}>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-[13px] font-bold text-white">DH</span>
            {!narrow ? (
              <span className="leading-tight">
                <span className="block text-sm font-semibold text-fg">DHM Business OS</span>
                <span className="block text-[11px] text-muted">Digi Help Media</span>
              </span>
            ) : null}
          </Link>
          {isMobile ? (
            <button onClick={onMobileClose} className="rounded-md p-1.5 text-muted hover:bg-surface-2" aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
          ) : null}
        </div>
        <nav className="thin-scroll flex-1 overflow-y-auto px-2 py-3">
          <ul className="space-y-0.5">
            {groups.map((g) => {
              const Icon = ICONS[g.icon] ?? LayoutDashboard;
              const groupActive = g.href ? isActive(g.href) : g.items?.some((i) => isActive(i.href));
              const open = openGroups[g.key] ?? groupActive;
              if (g.href || narrow) {
                const href = g.href ?? g.items![0]!.href;
                return (
                  <li key={g.key}>
                    <Link
                      href={href}
                      onClick={onMobileClose}
                      title={narrow ? g.label : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors",
                        narrow && "justify-center",
                        groupActive ? "bg-brand-soft text-brand" : "text-muted hover:bg-surface-2 hover:text-fg",
                      )}
                    >
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      {!narrow ? <span className="flex-1 truncate">{g.label}</span> : null}
                      {!narrow && g.key === "notifications" && unread > 0 ? (
                        <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">{unread > 99 ? "99+" : unread}</span>
                      ) : null}
                    </Link>
                  </li>
                );
              }
              return (
                <li key={g.key}>
                  <button
                    onClick={() => setOpenGroups((s) => ({ ...s, [g.key]: !open }))}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors",
                      groupActive ? "text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                    )}
                    aria-expanded={open}
                  >
                    <Icon className={cn("h-[18px] w-[18px] shrink-0", groupActive && "text-brand")} />
                    <span className="flex-1 truncate text-left">{g.label}</span>
                    <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
                  </button>
                  {open ? (
                    <ul className="mb-1 ml-[21px] mt-0.5 space-y-0.5 border-l border-line pl-3">
                      {g.items!.map((i) => (
                        <li key={i.href}>
                          <Link
                            href={i.href}
                            onClick={onMobileClose}
                            className={cn(
                              "block rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                              isActive(i.href) ? "bg-brand-soft font-medium text-brand" : "text-muted hover:bg-surface-2 hover:text-fg",
                            )}
                          >
                            {i.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </nav>
        {!isMobile ? (
          <div className="border-t border-line p-2">
            <button
              onClick={toggleCollapsed}
              className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-muted hover:bg-surface-2 hover:text-fg", narrow && "justify-center")}
            >
              {narrow ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              {!narrow ? "Collapse sidebar" : null}
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <aside
        className={cn(
          "no-print sticky top-0 hidden h-screen shrink-0 border-r border-line bg-surface transition-[width] duration-200 lg:block",
          collapsed ? "w-[68px]" : "w-[264px]",
        )}
      >
        {content(false)}
      </aside>
      {mobileOpen ? (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={onMobileClose} />
          <aside className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] bg-surface shadow-xl">{content(true)}</aside>
        </div>
      ) : null}
    </>
  );
}
