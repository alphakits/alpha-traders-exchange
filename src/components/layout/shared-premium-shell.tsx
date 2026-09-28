"use client";

import type { ReactNode } from "react";

export function SharedPremiumShell({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-slate-950 text-slate-100">{children}</div>;
}
