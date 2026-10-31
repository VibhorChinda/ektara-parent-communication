"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import { api } from "@/lib/api";
import { plainError } from "@/lib/errors";
import { fillTemplate } from "@/lib/templates";
import type { CampaignDetail, Message } from "@/lib/types";

const COUNT_ORDER = ["queued", "sent", "delivered", "read", "confirmed", "declined", "flagged", "failed"];
const POLL_MS = 10_000;

function details(m: Message): string {
  if (m.status === "confirmed" || m.status === "declined") {
    return m.confirmed_via === "voice" ? "Answered on the phone call" : "Answered on WhatsApp";
  }
  if (m.call_status) return `Call: ${m.call_status}`;
  if (m.wa_error) return plainError(m.wa_error);
  if (!m.parents.has_whatsapp) return "No WhatsApp: will be called";
  return "";
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [error, setError] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  useEffect(() => {
    function load() {
      api<CampaignDetail>(`/api/campaigns/${id}`)
        .then((c) => {
          setCampaign(c);
          setError("");
        })
        .catch((e) => setError(e.message));
    }
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [id]);

  if (error && !campaign) return <p className="text-red-600">{error}</p>;
  if (!campaign) return <p className="text-gray-500">Loading...</p>;

  const messages = flaggedOnly ? campaign.messages.filter((m) => m.status === "flagged") : campaign.messages;

  return (
    <div className="space-y-5">
      <Link href="/campaigns" className="text-sm text-blue-600 hover:underline">&larr; All campaigns</Link>
      <div>
        <h1 className="text-2xl font-semibold">
          Class {campaign.class_name}: {campaign.template_name}
        </h1>
        <p className="text-sm text-gray-500">
          {new Date(campaign.created_at).toLocaleString()} &middot; {campaign.status}
        </p>
      </div>

      <p className="whitespace-pre-wrap rounded border bg-white p-4 text-sm">
        {fillTemplate(campaign.template_body, campaign.variables)}
      </p>

      {error && <p className="text-sm text-red-600">Could not refresh: {error}</p>}

      <div className="flex flex-wrap gap-3">
        {COUNT_ORDER.map((s) => (
          <div key={s} className="rounded bg-white px-4 py-2 text-center shadow">
            <div className="text-xl font-semibold">{campaign.counts[s]}</div>
            <StatusBadge status={s} />
          </div>
        ))}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />
        Flagged only (needs personal follow-up)
      </label>

      {messages.length === 0 ? (
        <p className="text-gray-500">{flaggedOnly ? "No flagged parents." : "No messages."}</p>
      ) : (
        <div className="overflow-x-auto rounded bg-white shadow">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-left">
              <tr>
                <th className="p-2">Parent</th>
                <th className="p-2">Child</th>
                <th className="p-2">Phone</th>
                <th className="p-2">Status</th>
                <th className="p-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="p-2">{m.parents.parent_name}</td>
                  <td className="p-2">{m.parents.child_name}</td>
                  <td className="p-2">{m.parents.phone_e164}</td>
                  <td className="p-2"><StatusBadge status={m.status} /></td>
                  <td className="p-2 text-gray-600">{details(m)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
