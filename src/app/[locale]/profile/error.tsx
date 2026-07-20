"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="section-container page-shell py-12">
      <Card className="mx-auto max-w-2xl border-amber-500/25 bg-[#0B0B0B]/95">
        <CardHeader>
          <CardTitle>Something went wrong loading your profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-[#D1D5DB]">
          <p>We couldn&apos;t load this screen right now. Please refresh and try again.</p>
          <Button onClick={reset}>Try Again</Button>
        </CardContent>
      </Card>
    </section>
  );
}
