export function PageLoadingSkeleton() {
  return (
    <section className="section-container page-shell">
      <div className="space-y-4">
        <div className="relative overflow-hidden rounded-xl bg-white/10">
          <div className="h-10 w-2/3 motion-safe:animate-pulse rounded-xl bg-white/10" />
          <div className="pointer-events-none absolute inset-0 -translate-x-full motion-safe:animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        </div>
        <div className="relative overflow-hidden rounded-xl bg-white/10">
          <div className="h-5 w-full max-w-2xl motion-safe:animate-pulse rounded-xl bg-white/10" />
          <div className="pointer-events-none absolute inset-0 -translate-x-full motion-safe:animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="relative overflow-hidden rounded-2xl">
              <div className="surface-panel-subtle h-40 motion-safe:animate-pulse" />
              <div className="pointer-events-none absolute inset-0 -translate-x-full motion-safe:animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
