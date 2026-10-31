const STYLES: Record<string, string> = {
  // message statuses
  queued: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-800",
  delivered: "bg-indigo-100 text-indigo-800",
  read: "bg-purple-100 text-purple-800",
  confirmed: "bg-green-100 text-green-800",
  declined: "bg-orange-100 text-orange-800",
  flagged: "bg-red-100 text-red-800",
  failed: "bg-red-200 text-red-900",
  // template statuses
  draft: "bg-gray-100 text-gray-700",
  pending_meta: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

const LABELS: Record<string, string> = {
  pending_meta: "Pending Meta",
};

export default function StatusBadge({ status }: { status: string }) {
  const label = LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STYLES[status] ?? "bg-gray-100"}`}>
      {label}
    </span>
  );
}
