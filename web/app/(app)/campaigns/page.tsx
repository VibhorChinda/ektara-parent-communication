"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AudiencePicker from "@/components/AudiencePicker";
import Icon from "@/components/Icon";
import ResponseBar, { Legend } from "@/components/ResponseBar";
import StatusBadge from "@/components/StatusBadge";
import { Alert, Button, buttonClass, Card, EmptyState, PageHeader, SearchInput, SkeletonRows } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, percent, timeAgo } from "@/lib/format";
import { groupCount, sumCounts } from "@/lib/status";
import type { Audience, Campaign, Group } from "@/lib/types";

const PAGE_SIZE = 50; // matches the backend

function listUrl(audience: Audience | null, offset: number): string {
  const params = new URLSearchParams({ offset: String(offset) });
  if (audience?.institution) params.set("institution", audience.institution);
  if (audience?.class_or_year) params.set("class_or_year", audience.class_or_year);
  if (audience?.section) params.set("section", audience.section);
  return `/api/campaigns?${params}`;
}

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [audience, setAudience] = useState<Audience | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    api<Group[]>("/api/parents/groups").then(setGroups).catch(() => setGroups([]));
  }, []);

  // Reload from the first page whenever the filter changes.
  useEffect(() => {
    setCampaigns(null);
    api<Campaign[]>(listUrl(audience, 0))
      .then((list) => {
        setCampaigns(list);
        setHasMore(list.length === PAGE_SIZE);
      })
      .catch((e) => setError(e.message));
  }, [audience]);

  async function loadMore() {
    if (!campaigns) return;
    setLoadingMore(true);
    try {
      const more = await api<Campaign[]>(listUrl(audience, campaigns.length));
      setCampaigns([...campaigns, ...more]);
      setHasMore(more.length === PAGE_SIZE);
    } catch (e) {
      setError((e as Error).message);
    }
    setLoadingMore(false);
  }

  const q = query.trim().toLowerCase();
  const shown = (campaigns ?? []).filter(
    (c) => !q || c.audience.toLowerCase().includes(q) || c.template_name.toLowerCase().includes(q),
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

      {campaigns?.length === 0 && !audience && (
        <EmptyState
          icon="send"
          title="No campaigns yet"
          description="Pick a class and an approved template to send your first announcement."
          action={<Link href="/campaigns/new" className={buttonClass("primary")}>New campaign</Link>}
        />
      )}

      {groups.length > 0 && (campaigns?.length !== 0 || audience) && (
        <Card className="mb-6 p-4">
          <AudiencePicker groups={groups.map((g) => ({ ...g, count: g.parent_count }))} value={audience} onChange={setAudience} allowAll />
        </Card>
      )}

      {!error && campaigns === null && <SkeletonRows />}

      {campaigns?.length === 0 && audience && (
        <p className="py-10 text-center text-sm text-zinc-500">No campaigns for this group yet.</p>
      )}

      {campaigns && campaigns.length > 0 && (
        <div className="space-y-6">
          <Summary campaigns={campaigns} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <SearchInput value={query} onChange={setQuery} placeholder="Search group or template" />
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
                          <div className="flex flex-wrap items-center gap-2">
                            <Link href={`/campaigns/${c.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">
                              {c.template_name}
                            </Link>
                            {c.status !== "sent" && <StatusBadge status={c.status} />}
                          </div>
                          <p className="mt-0.5 text-xs text-zinc-600">{c.audience}</p>
                          <p className="mt-0.5 text-xs text-zinc-400">
                            <span title={formatDate(c.created_at)}>{timeAgo(c.created_at)}</span>
                            {c.sender && <> &middot; by {c.sender}</>}
                          </p>
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

          {hasMore && (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={loadMore} loading={loadingMore}>Load older campaigns</Button>
            </div>
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
    { label: "Parents messaged", value: total.toLocaleString(), note: `in ${campaigns.length} campaigns shown` },
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
