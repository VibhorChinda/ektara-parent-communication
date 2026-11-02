"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import ResponseBar, { Legend } from "@/components/ResponseBar";
import StatusBadge, { statusLabel } from "@/components/StatusBadge";
import { useToast } from "@/components/Toast";
import WhatsAppPreview from "@/components/WhatsAppPreview";
import { Alert, Button, Card, PageHeader, SearchInput, Skeleton, Tabs } from "@/components/ui";
import { api } from "@/lib/api";
import { plainError } from "@/lib/errors";
import { downloadCsv, formatDate, percent, timeAgo } from "@/lib/format";
import { GROUPS, groupCount, type GroupKey } from "@/lib/status";
import type { CampaignDetail, Message } from "@/lib/types";

const POLL_MS = 10_000;

function details(m: Message): string {
  if (m.status === "confirmed" || m.status === "declined") {
    return m.confirmed_via === "voice" ? "Answered on the phone call" : "Answered on WhatsApp";
  }
  if (m.call_status) return `Call: ${m.call_status.replace("-", " ")}`;
  if (m.wa_error) return plainError(m.wa_error);
  if (!m.parents.has_whatsapp) return "No WhatsApp: will be called";
  if (m.status === "read") return "Read, no reply yet";
  return "";
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [tab, setTab] = useState<GroupKey | "all">("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    function load() {
      if (document.hidden) return; // don't poll in a background tab
      api<CampaignDetail>(`/api/campaigns/${id}`)
        .then((c) => {
          setCampaign(c);
          setUpdatedAt(new Date());
          setError("");
        })
        .catch((e) => setError(e.message));
    }
    load();
    const timer = setInterval(load, POLL_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [id]);

  if (error && !campaign) return <Alert>{error}</Alert>;
  if (!campaign) return <LoadingDetail />;

  const counts = campaign.counts;
  const total = counts.total ?? 0;
  const flagged = counts.flagged ?? 0;

  const group = GROUPS.find((g) => g.key === tab);
  const q = query.trim().toLowerCase();
  const messages = campaign.messages.filter((m) => {
    if (group && !group.statuses.includes(m.status)) return false;
    if (!q) return true;
    const p = m.parents;
    return [p.parent_name, p.child_name ?? "", p.phone_e164].some((v) => v.toLowerCase().includes(q));
  });

  function exportCsv() {
    const rows = [["Parent", "Child", "Phone", "Status", "Details"]];
    for (const m of messages) {
      rows.push([m.parents.parent_name, m.parents.child_name ?? "", m.parents.phone_e164, statusLabel(m.status), details(m)]);
    }
    downloadCsv(`${campaign!.class_name}-${campaign!.template_name}-${tab}.csv`, rows);
  }

  async function copyPhone(phone: string) {
    try {
      await navigator.clipboard.writeText(phone);
      toast("Phone number copied");
    } catch {
      toast("Could not copy", "error");
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/campaigns" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900">
        <Icon name="back" /> All campaigns
      </Link>

      <PageHeader
        title={`Class ${campaign.class_name}`}
        description={
          <>
            <span className="font-medium text-zinc-700">{campaign.template_name}</span> &middot; sent {formatDate(campaign.created_at)}
          </>
        }
        actions={<LiveIndicator updatedAt={updatedAt} error={error} sending={campaign.status === "sending"} />}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card className="p-5">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-medium text-zinc-500">Responses</p>
              <p className="text-sm text-zinc-500">
                <span className="text-lg font-semibold text-zinc-900">{percent(counts.confirmed ?? 0, total)}%</span> confirmed
              </p>
            </div>
            <ResponseBar counts={counts} className="mt-3 h-3" />
            <div className="mt-3"><Legend /></div>
          </Card>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {GROUPS.map((g) => {
              const n = groupCount(counts, g.statuses);
              return (
                <button
                  key={g.key}
                  onClick={() => setTab(tab === g.key ? "all" : g.key)}
                  className={`rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-zinc-300 ${
                    tab === g.key ? "border-zinc-900 ring-1 ring-zinc-900" : "border-zinc-200"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                    <span className={`size-2 rounded-full ${g.color}`} /> {g.label}
                  </span>
                  <span className="mt-1 block text-2xl font-semibold tabular-nums">{n}</span>
                  <span className="text-xs text-zinc-400">{percent(n, total)}% of {total}</span>
                </button>
              );
            })}
          </div>

          {flagged > 0 && tab !== "flagged" && (
            <Alert tone="warning">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <b>{flagged} {flagged === 1 ? "parent needs" : "parents need"}</b> a personal follow-up. They didn&apos;t answer WhatsApp or the automatic call.
                </span>
                <button onClick={() => setTab("flagged")} className="font-medium underline underline-offset-2">Show them</button>
              </div>
            </Alert>
          )}
        </div>

        <Card className="h-fit p-4 lg:sticky lg:top-6">
          <p className="mb-3 text-sm font-medium text-zinc-500">Message sent</p>
          <WhatsAppPreview body={campaign.template_body} values={campaign.variables} hasButtons={campaign.template_has_buttons} />
        </Card>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[{ key: "all" as const, label: "All", count: total }, ...GROUPS.map((g) => ({ key: g.key, label: g.label, count: groupCount(counts, g.statuses) }))]}
          />
          <div className="flex w-full gap-2 sm:w-auto">
            <SearchInput value={query} onChange={setQuery} placeholder="Search parent, child or phone" />
            <Button variant="secondary" onClick={exportCsv} disabled={messages.length === 0} title="Download this list as CSV">
              <Icon name="download" /> <span className="hidden sm:inline">Export</span>
            </Button>
          </div>
        </div>

        {messages.length === 0 ? (
          <Card className="py-12 text-center text-sm text-zinc-500">
            {q ? `No parents match “${query}”.` : tab === "flagged" ? "Nobody needs a follow-up." : "No parents in this group."}
          </Card>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Parent</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Details</th>
                  <th className="px-4 py-3 text-right font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {messages.map((m) => (
                  <tr key={m.id} className="group hover:bg-zinc-50">
                    <td className="px-4 py-3">
                      <p className="font-medium">{m.parents.parent_name}</p>
                      {m.parents.child_name && <p className="text-xs text-zinc-500">Parent of {m.parents.child_name}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-xs text-zinc-700">{m.parents.phone_e164}</span>
                        <a href={`tel:${m.parents.phone_e164}`} title="Call" aria-label={`Call ${m.parents.parent_name}`} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900">
                          <Icon name="phone" className="size-3.5" />
                        </a>
                        <button onClick={() => copyPhone(m.parents.phone_e164)} title="Copy number" aria-label="Copy number" className="rounded p-1 text-zinc-400 opacity-0 hover:bg-zinc-100 hover:text-zinc-900 focus:opacity-100 group-hover:opacity-100">
                          <Icon name="copy" className="size-3.5" />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={m.status} /></td>
                    <td className="px-4 py-3 text-zinc-500">{details(m)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-xs text-zinc-400" title={formatDate(m.updated_at)}>
                      {timeAgo(m.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}

function LiveIndicator({ updatedAt, error, sending }: { updatedAt: Date | null; error: string; sending: boolean }) {
  if (error) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800" title={error}>
        <Icon name="refresh" className="size-3.5" /> Can&apos;t refresh, retrying
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs text-zinc-500 ring-1 ring-zinc-200">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
      </span>
      {sending ? "Sending messages..." : "Live"}
      {updatedAt && <span className="text-zinc-400">&middot; {updatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>}
    </span>
  );
}

function LoadingDetail() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
