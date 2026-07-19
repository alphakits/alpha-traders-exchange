export default function LocaleLoading() {
  return (
    <section className="section-container page-shell">
      <div className="animate-pulse space-y-4">
        <div className="h-10 w-2/3 rounded-xl bg-white/10" />
        <div className="h-5 w-full max-w-2xl rounded-xl bg-white/10" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-40 rounded-2xl border border-white/10 bg-white/5" />
          ))}
        </div>
      </div>
    </section>
  );
}
