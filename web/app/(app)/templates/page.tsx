"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import { api } from "@/lib/api";
import type { Template } from "@/lib/types";

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState("");
  const [retryingId, setRetryingId] = useState<string | null>(null);

  function load() {
    api<Template[]>("/api/templates")
      .then(setTemplates)
      .catch((e) => setError(e.message));
  }

  useEffect(load, []);

  async function retry(id: string) {
    setRetryingId(id);
    setError("");
    try {
      await api(`/api/templates/${id}/submit`, { method: "POST" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
    setRetryingId(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Templates</h1>
        <Link href="/templates/new" className="rounded bg-blue-600 px-4 py-2 text-sm text-white">
          Request new template
        </Link>
      </div>
      <p className="text-sm text-gray-600">
        New templates go straight to WhatsApp (Meta) for approval. This usually takes 5 minutes to 24 hours.
      </p>

      {error && <p className="text-red-600">{error}</p>}
      {!error && templates === null && <p className="text-gray-500">Loading...</p>}
      {templates?.length === 0 && <p className="text-gray-500">No templates yet.</p>}

      <div className="space-y-3">
        {templates?.map((t) => (
          <div key={t.id} className="rounded bg-white p-4 shadow">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t.name}</span>
              <span className="text-xs text-gray-500">{t.language} &middot; {t.category}</span>
              <StatusBadge status={t.status} />
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{t.body}</p>

            {t.status === "rejected" && (
              <div className="mt-3 space-y-2">
                <p className="text-sm text-red-700">Reason: {t.rejection_reason || "No reason given"}</p>
                <Link href={`/templates/new?from=${t.id}`} className="text-sm text-blue-600 hover:underline">
                  Edit and resubmit
                </Link>
              </div>
            )}

            {t.status === "draft" && (
              <div className="mt-3 space-y-2">
                <p className="text-sm text-gray-600">Not sent to WhatsApp yet (the last attempt failed).</p>
                <button
                  onClick={() => retry(t.id)}
                  disabled={retryingId !== null}
                  className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                >
                  {retryingId === t.id ? "Submitting..." : "Retry submit"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
