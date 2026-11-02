"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import ResponseBar, { Legend } from "@/components/ResponseBar";
import StatusBadge from "@/components/StatusBadge";
import { Alert, buttonClass, Card, EmptyState, PageHeader, SearchInput, SkeletonRows } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, percent, timeAgo } from "@/lib/format";
import { groupCount, sumCounts } from "@/lib/status";
import type { Campaign } from "@/lib/types";

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    api<Campaign[]>("/api/campaigns")
      .then(setCampaigns)
      .catch((e) => setError(e.message));
  }, []);

  const q = query.trim().toLowerCase();
  const shown = (campaigns ?? []).filter(
    (c) => !q || c.class_name.toLowerCase().includes(q) || c.template_name.toLowerCase().includes(q),
  );

  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Announcements sent to parents and how they responded."
        actions={
          <Link href="/campaigns/new" className={buttonClass("primary")}>
            <Icon name="plus" /> New campaign
          </Link>
        }
      />

      {error && <Alert>{error}</Alert>}
      {!error && campaigns === null && <SkeletonRows />}

      {campaigns?.length === 0 && (
        <EmptyState
          icon="send"
          title="No campaigns yet"
          description="Pick a class and an approved template to send your first announcement."
          action={<Link href="/campaigns/new" className={buttonClass("primary")}>New campaign</Link>}
        />
      )}

      {campaigns && campaigns.length > 0 && (
        <div className="space-y-6">
          <Summary campaigns={campaigns} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <SearchInput value={query} onChange={setQuery} placeholder="Search class or template" />
            <Legend />
          </div>

          {shown.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-500">No campaigns match &ldquo;{query}&rdquo;.</p>
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-100 text-left text-xs font-medium uppercase tracking-wide text-zinc-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Campaign</th>
                    <th className="px-4 py-3 font-medium">Parents</th>
                    <th className="w-64 px-4 py-3 font-medium">Responses</th>
                    <th className="px-4 py-3 font-medium">Follow-up</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {shown.map((c) => {
                    const total = c.counts.total ?? 0;
                    const flagged = c.counts.flagged ?? 0;
                    return (
                      <tr key={c.id} onClick={() => router.push(`/campaigns/${c.id}`)} className="cursor-pointer transition hover:bg-zinc-50">
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2">
                            <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700">{c.class_name}</span>
                            <Link href={`/campaigns/${c.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">
                              {c.template_name}
                            </Link>
                            {c.status !== "sent" && <StatusBadge status={c.status} />}
                          </div>
                          <p className="mt-1 text-xs text-zinc-400" title={formatDate(c.created_at)}>{timeAgo(c.created_at)}</p>
                        </td>
                        <td className="px-4 py-3.5 tabular-nums text-zinc-600">{total}</td>
                        <td className="px-4 py-3.5">
                          <ResponseBar counts={c.counts} />
                          <p className="mt-1.5 text-xs text-zinc-500">
                            <span className="font-medium text-zinc-800">{percent(c.counts.confirmed ?? 0, total)}%</span> confirmed
                          </p>
                        </td>
                        <td className="px-4 py-3.5">
                          {flagged > 0 ? (
                            <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">{flagged} to call</span>
                          ) : (
                            <span className="text-xs text-zinc-400">None</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function Summary({ campaigns }: { campaigns: Campaign[] }) {
  const counts = sumCounts(campaigns.map((c) => c.counts));
  const total = counts.total ?? 0;
  const stats = [
    { label: "Parents messaged", value: total.toLocaleString(), note: `in ${campaigns.length} campaigns` },
    { label: "Confirmed", value: `${percent(counts.confirmed ?? 0, total)}%`, note: `${counts.confirmed ?? 0} parents` },
    { label: "Awaiting reply", value: groupCount(counts, ["queued", "sent", "delivered", "read"]).toLocaleString(), note: "WhatsApp, then a call" },
    { label: "Needs follow-up", value: (counts.flagged ?? 0).toLocaleString(), note: "no reply to the call", alert: (counts.flagged ?? 0) > 0 },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((s) => (
        <Card key={s.label} className="p-4">
          <p className="text-xs font-medium text-zinc-500">{s.label}</p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${s.alert ? "text-red-600" : ""}`}>{s.value}</p>
          <p className="mt-0.5 text-xs text-zinc-400">{s.note}</p>
        </Card>
      ))}
    </div>
  );
}
