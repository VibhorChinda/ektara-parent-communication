"use client";

import { useEffect, useState } from "react";
import StatusBadge from "./StatusBadge";
import { useToast } from "./Toast";
import { Alert, Button, Drawer, Skeleton } from "./ui";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { eventSummary, messageDetails } from "@/lib/messages";
import type { Message, MessageEvent } from "@/lib/types";

type Props = { message: Message | null; onClose: () => void; onChanged: () => void };

export default function MessageDrawer({ message, onClose, onChanged }: Props) {
  return (
    <Drawer
      open={!!message}
      title={message?.parents.parent_name ?? ""}
      subtitle={message && `${message.parents.phone_e164}${message.parents.child_name ? ` · parent of ${message.parents.child_name}` : ""}`}
      onClose={onClose}
    >
      {message && <MessageBody key={message.id} message={message} onChanged={onChanged} />}
    </Drawer>
  );
}

function MessageBody({ message: m, onChanged }: { message: Message; onChanged: () => void }) {
  const toast = useToast();
  const [events, setEvents] = useState<MessageEvent[] | null>(null);
  const [saving, setSaving] = useState<"confirmed" | "declined" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<MessageEvent[]>(`/api/messages/${m.id}/events`)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [m.id, m.status]);

  async function resolve(outcome: "confirmed" | "declined") {
    setSaving(outcome);
    setError("");
    try {
      await api(`/api/messages/${m.id}/resolve`, { method: "POST", body: JSON.stringify({ outcome }) });
      toast(outcome === "confirmed" ? "Marked as confirmed" : "Marked as declined");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
    setSaving(null);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <StatusBadge status={m.status} />
          <span className="text-sm text-zinc-500">{messageDetails(m)}</span>
        </div>
        {m.reply_text && (
          <div className="rounded-lg rounded-tl-none bg-[#efeae2] p-3">
            <p className="whitespace-pre-wrap rounded-lg bg-white px-3 py-2 text-sm shadow-sm">{m.reply_text}</p>
            {m.replied_at && <p className="mt-1 text-xs text-zinc-500">Replied {formatDate(m.replied_at)}</p>}
          </div>
        )}
      </section>

      {m.status !== "cancelled" && (
        <section className="space-y-3 rounded-xl border border-zinc-200 p-4">
          <p className="text-sm font-medium">Spoke to the parent yourself?</p>
          <p className="text-xs text-zinc-500">Record their answer. It replaces anything recorded so far and stops the automatic call.</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" loading={saving === "confirmed"} disabled={!!saving || m.status === "confirmed"} onClick={() => resolve("confirmed")}>
              Mark confirmed
            </Button>
            <Button variant="secondary" size="sm" loading={saving === "declined"} disabled={!!saving || m.status === "declined"} onClick={() => resolve("declined")}>
              Mark declined
            </Button>
            <a href={`tel:${m.parents.phone_e164}`} className="ml-auto text-sm font-medium text-zinc-600 hover:text-zinc-900">Call now</a>
          </div>
          {error && <Alert>{error}</Alert>}
        </section>
      )}

      <section>
        <h3 className="mb-3 text-sm font-medium text-zinc-500">Timeline</h3>
        {events === null && <Skeleton className="h-24 w-full" />}
        {events?.length === 0 && <p className="text-sm text-zinc-400">Nothing recorded yet.</p>}
        {events && events.length > 0 && (
          <ol className="space-y-3 border-l border-zinc-200 pl-4">
            {events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-zinc-300" />
                <p className="text-sm">{eventSummary(e)}</p>
                <p className="text-xs text-zinc-400">{formatDate(e.created_at)}</p>
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-700">Raw data</summary>
                  <pre className="mt-1 overflow-x-auto rounded-lg bg-zinc-50 p-2 text-[11px] leading-relaxed text-zinc-600">
                    {JSON.stringify(e.payload, null, 2)}
                  </pre>
                </details>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
