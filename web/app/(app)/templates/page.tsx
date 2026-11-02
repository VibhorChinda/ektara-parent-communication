"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import MessageText from "@/components/MessageText";
import StatusBadge from "@/components/StatusBadge";
import { useToast } from "@/components/Toast";
import { Alert, Button, buttonClass, Card, EmptyState, PageHeader, SearchInput, SkeletonRows, Tabs } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, timeAgo } from "@/lib/format";
import { languageName } from "@/lib/templates";
import type { Template, TemplateStatus } from "@/lib/types";

const REFRESH_MS = 30_000;

const TABS: { key: TemplateStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "approved", label: "Approved" },
  { key: "pending_meta", label: "Pending" },
  { key: "rejected", label: "Rejected" },
  { key: "draft", label: "Draft" },
];

export default function TemplatesPage() {
  const toast = useToast();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState("");
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [tab, setTab] = useState<TemplateStatus | "all">("all");
  const [query, setQuery] = useState("");

  function load() {
    api<Template[]>("/api/templates")
      .then((list) => {
        setTemplates(list);
        setError("");
      })
      .catch((e) => setError(e.message));
  }

  useEffect(load, []);

  // While Meta is reviewing something, check again every 30 s.
  const hasPending = templates?.some((t) => t.status === "pending_meta") ?? false;
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => !document.hidden && load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [hasPending]);

  async function retry(id: string) {
    setRetryingId(id);
    setError("");
    try {
      await api(`/api/templates/${id}/submit`, { method: "POST" });
      toast("Sent to Meta for approval");
      load();
    } catch (e) {
      setError((e as Error).message);
    }
    setRetryingId(null);
  }

  const q = query.trim().toLowerCase();
  const shown = (templates ?? []).filter(
    (t) => (tab === "all" || t.status === tab) && (!q || t.name.includes(q) || t.body.toLowerCase().includes(q)),
  );

  return (
    <div>
      <PageHeader
        title="Templates"
        description="WhatsApp only delivers messages that Meta has approved. Review usually takes 5 minutes to 24 hours."
        actions={
          <Link href="/templates/new" className={buttonClass("primary")}>
            <Icon name="plus" /> Request template
          </Link>
        }
      />

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {!error && templates === null && <SkeletonRows />}

      {templates?.length === 0 && (
        <EmptyState
          icon="doc"
          title="No templates yet"
          description="Write a message like a PTM reminder and send it to Meta for approval."
          action={<Link href="/templates/new" className={buttonClass("primary")}>Request template</Link>}
        />
      )}

      {templates && templates.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs
              active={tab}
              onChange={setTab}
              tabs={TABS.map((t) => ({ ...t, count: t.key === "all" ? templates.length : templates.filter((x) => x.status === t.key).length }))}
            />
            <SearchInput value={query} onChange={setQuery} placeholder="Search templates" />
          </div>

          {shown.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-500">No templates here.</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {shown.map((t) => (
                <Card key={t.id} className="flex flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{t.name}</p>
                      <p className="mt-0.5 text-xs text-zinc-400">
                        {languageName(t.language)} &middot; {t.category.toLowerCase()} &middot;{" "}
                        <span title={formatDate(t.created_at)}>{timeAgo(t.created_at)}</span>
                      </p>
                    </div>
                    <StatusBadge status={t.status} />
                  </div>

                  <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed text-zinc-600">
                    <MessageText body={t.body} labels={t.variable_names} />
                  </p>
                  {t.has_confirm_buttons && (
                    <p className="mt-2 text-xs text-zinc-400">With Confirm / Can&apos;t attend buttons</p>
                  )}

                  <div className="mt-auto pt-4">
                    <TemplateFooter template={t} retrying={retryingId === t.id} busy={retryingId !== null} onRetry={() => retry(t.id)} />
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TemplateFooter({ template: t, retrying, busy, onRetry }: { template: Template; retrying: boolean; busy: boolean; onRetry: () => void }) {
  if (t.status === "approved") {
    return (
      <Link href={`/campaigns/new?template=${t.id}`} className={buttonClass("secondary", "sm")}>
        <Icon name="send" className="size-3.5" /> Use in campaign
      </Link>
    );
  }
  if (t.status === "pending_meta") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-zinc-500">
        <Icon name="clock" className="size-3.5" /> Waiting for Meta&apos;s review. This page updates on its own.
      </p>
    );
  }
  if (t.status === "rejected") {
    return (
      <div className="space-y-3">
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
          <b>Meta&apos;s reason:</b> {t.rejection_reason || "No reason given"}
        </p>
        <Link href={`/templates/new?from=${t.id}`} className={buttonClass("secondary", "sm")}>Edit and resubmit</Link>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-zinc-500">Not sent to Meta yet (the last attempt failed).</p>
      <Button variant="secondary" size="sm" onClick={onRetry} loading={retrying} disabled={busy}>
        <Icon name="refresh" className="size-3.5" /> Retry submit
      </Button>
    </div>
  );
}
