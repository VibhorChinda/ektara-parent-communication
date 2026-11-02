import type { Counts } from "./types";

// Message statuses grouped the way admins think about them.
export type GroupKey = "confirmed" | "declined" | "awaiting" | "flagged" | "failed";

export const GROUPS: { key: GroupKey; label: string; statuses: string[]; color: string }[] = [
  { key: "confirmed", label: "Confirmed", statuses: ["confirmed"], color: "bg-emerald-500" },
  { key: "declined", label: "Declined", statuses: ["declined"], color: "bg-amber-400" },
  { key: "awaiting", label: "Awaiting reply", statuses: ["queued", "sent", "delivered", "read"], color: "bg-sky-300" },
  { key: "flagged", label: "Needs follow-up", statuses: ["flagged"], color: "bg-red-500" },
  { key: "failed", label: "Failed", statuses: ["failed"], color: "bg-zinc-400" },
];

export function groupCount(counts: Counts, statuses: string[]): number {
  return statuses.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
}

export function sumCounts(list: Counts[]): Counts {
  const total: Counts = {};
  for (const counts of list) {
    for (const [key, n] of Object.entries(counts)) total[key] = (total[key] ?? 0) + n;
  }
  return total;
}
