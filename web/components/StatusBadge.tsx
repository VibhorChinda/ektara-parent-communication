const STYLES: Record<string, string> = {
  // message statuses
  queued: "bg-zinc-100 text-zinc-600",
  sent: "bg-sky-50 text-sky-700",
  delivered: "bg-sky-50 text-sky-700",
  read: "bg-indigo-50 text-indigo-700",
  confirmed: "bg-emerald-50 text-emerald-700",
  declined: "bg-amber-50 text-amber-800",
  flagged: "bg-red-50 text-red-700",
  failed: "bg-zinc-100 text-zinc-700",
  cancelled: "bg-zinc-50 text-zinc-400",
  // template statuses
  draft: "bg-zinc-100 text-zinc-600",
  pending_meta: "bg-amber-50 text-amber-800",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
  // campaign statuses
  sending: "bg-sky-50 text-sky-700",
};

const LABELS: Record<string, string> = {
  pending_meta: "Pending Meta",
  flagged: "Needs follow-up",
};

export function statusLabel(status: string): string {
  return LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1);
}

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status] ?? "bg-zinc-100 text-zinc-600"}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {statusLabel(status)}
    </span>
  );
}
