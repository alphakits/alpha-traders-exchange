import type { Metadata } from "next";
import { BRAND_PRIMARY_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: { absolute: `غير متصل بالإنترنت | Offline | ${BRAND_PRIMARY_NAME}` },
  description: "أعد الاتصال للمتابعة. Reconnect to continue.",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0B0B0B] px-6 text-center text-white" dir="auto">
      <div className="grid max-w-md gap-6">
        <section lang="ar" dir="rtl" aria-labelledby="offline-title-ar">
          <h1 id="offline-title-ar" className="text-2xl font-semibold">
            أنت غير متصل بالإنترنت. أعد الاتصال للمتابعة.
          </h1>
          <p className="mt-3 text-sm text-[#D1D5DB]">
            تبقى إجراءات التداول معطلة حتى عودة الاتصال.
          </p>
        </section>

        <div className="mx-auto h-px w-24 bg-[#C9A227]/30" aria-hidden="true" />

        <section lang="en" dir="ltr" aria-labelledby="offline-title-en">
          <h2 id="offline-title-en" className="text-2xl font-semibold">
            You’re offline. Reconnect to continue trading.
          </h2>
          <p className="mt-3 text-sm text-[#D1D5DB]">
            Trading actions stay disabled until the connection returns.
          </p>
        </section>
      </div>
    </main>
  );
}
