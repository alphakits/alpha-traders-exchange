/** A visual cue paired with a readable label. Motion is finite and optional. */
export function AttentionSiren({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`attention-siren ${className}`}>🚨</span>;
}
