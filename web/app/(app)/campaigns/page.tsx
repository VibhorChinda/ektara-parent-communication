"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Campaign } from "@/lib/types";

const COLUMNS = ["sent", "delivered", "read", "confirmed", "declined", "flagged", "failed"];

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Campaign[]>("/api/campaigns")
      .then(setCampaigns)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Campaigns</h1>
        <Link href="/campaigns/new" className="rounded bg-blue-600 px-4 py-2 text-sm text-white">
          New campaign
        </Link>
      </div>

      {error && <p className="text-red-600">{error}</p>}
      {!error && campaigns === null && <p className="text-gray-500">Loading...</p>}
      {campaigns?.length === 0 && <p className="text-gray-500">No campaigns yet.</p>}

      {campaigns && campaigns.length > 0 && (
        <div className="overflow-x-auto rounded bg-white shadow">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-left">
              <tr>
                <th className="p-2">Date</th>
                <th className="p-2">Class</th>
                <th className="p-2">Template</th>
                <th className="p-2">Parents</th>
                {COLUMNS.map((c) => (
                  <th key={c} className="p-2 capitalize">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-t hover:bg-gray-50">
                  <td className="p-2">
                    <Link href={`/campaigns/${c.id}`} className="text-blue-600 hover:underline">
                      {new Date(c.created_at).toLocaleString()}
                    </Link>
                  </td>
                  <td className="p-2">{c.class_name}</td>
                  <td className="p-2">{c.template_name}</td>
                  <td className="p-2">{c.counts.total}</td>
                  {COLUMNS.map((col) => (
                    <td key={col} className="p-2">{c.counts[col]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
