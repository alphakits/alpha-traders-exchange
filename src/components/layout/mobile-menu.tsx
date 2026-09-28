"use client";

import Link from "next/link";

export function MobileMenu() {
  return (
    <nav className="space-y-2 rounded-2xl border border-white/10 bg-slate-900/90 p-4 text-sm">
      <Link className="block rounded-xl px-3 py-2 hover:bg-white/5" href="/dashboard">
        Dashboard
      </Link>
      <Link className="block rounded-xl px-3 py-2 hover:bg-white/5" href="/dashboard/seller">
        Seller Dashboard
      </Link>
      <Link className="block rounded-xl px-3 py-2 hover:bg-white/5" href="/usdt-exchange">
        Marketplace
      </Link>
    </nav>
  );
}
