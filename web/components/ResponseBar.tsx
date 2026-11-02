import { GROUPS, groupCount } from "@/lib/status";
import type { Counts } from "@/lib/types";

// One stacked bar: confirmed / declined / awaiting / follow-up / failed.
export default function ResponseBar({ counts, className = "h-2" }: { counts: Counts; className?: string }) {
  const total = counts.total ?? 0;
  const label = GROUPS.map((g) => `${g.label}: ${groupCount(counts, g.statuses)}`).join(", ");
  return (
    <div role="img" aria-label={label} className={`flex w-full gap-px overflow-hidden rounded-full bg-zinc-100 ${className}`}>
      {total > 0 &&
        GROUPS.map((g) => {
          const n = groupCount(counts, g.statuses);
          if (!n) return null;
          return <div key={g.key} className={`${g.color} transition-all`} style={{ width: `${(n / total) * 100}%` }} title={`${g.label}: ${n}`} />;
        })}
    </div>
  );
}

export function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
      {GROUPS.map((g) => (
        <span key={g.key} className="flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${g.color}`} />
          {g.label}
        </span>
      ))}
    </div>
  );
}
