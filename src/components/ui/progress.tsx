import { cn } from "@/lib/utils";

export function Progress({ value, className, label = "Progress" }: { value: number; className?: string; label?: string }) {
  const percent = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} data-complete={percent === 100 ? "true" : undefined} className={cn("alpha-progress h-2 w-full overflow-hidden rounded-full", className)}>
      <div
        className="alpha-progress__fill"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
