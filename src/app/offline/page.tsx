export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0B0B0B] px-6 text-center text-white">
      <div className="max-w-md">
        <p className="text-2xl font-semibold">You&apos;re offline. Reconnect to continue trading.</p>
        <p className="mt-3 text-sm text-[#D1D5DB]">Trading actions stay disabled until the connection returns.</p>
      </div>
    </main>
  );
}
