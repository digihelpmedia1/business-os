"use client";

import * as React from "react";
import type { AccessMap } from "@/lib/permissions";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({
  user,
  unread,
  currency,
  currencies,
  children,
}: {
  user: { name: string; email: string; roleName: string; access: AccessMap; hasEmployee: boolean };
  unread: number;
  currency: string;
  currencies: string[];
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  return (
    <div className="flex min-h-screen">
      <Sidebar access={user.access} hasEmployee={user.hasEmployee} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} unread={unread} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} unread={unread} currency={currency} currencies={currencies} onMenu={() => setMobileOpen(true)} />
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
