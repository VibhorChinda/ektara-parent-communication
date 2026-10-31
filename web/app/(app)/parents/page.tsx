"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ClassInfo } from "@/lib/types";

type UploadResult = {
  inserted: number;
  updated: number;
  rejected: number;
  errors: { row: number; phone: string | null; reason: string }[];
};

export default function ParentsPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState("");
  const [classes, setClasses] = useState<ClassInfo[] | null>(null);

  function loadClasses() {
    api<ClassInfo[]>("/api/parents/classes")
      .then(setClasses)
      .catch((e) => setError(e.message));
  }

  useEffect(loadClasses, []);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError("");
    setResult(null);
    const form = new FormData();
    form.append("file", file);
    try {
      setResult(await api<UploadResult>("/api/parents/upload", { method: "POST", body: form }));
      loadClasses();
    } catch (e) {
      setError((e as Error).message);
    }
    setUploading(false);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Parents</h1>

      <form onSubmit={upload} className="space-y-3 rounded bg-white p-4 shadow">
        <p className="text-sm text-gray-600">
          Upload a CSV with the columns{" "}
          <code>parent_name, phone, child_name, class_name, language, has_whatsapp</code>. Existing parents
          (same phone) are updated.
        </p>
        <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <div>
          <button
            type="submit"
            disabled={!file || uploading}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "Upload"}
          </button>
        </div>
      </form>

      {error && <p className="text-red-600">{error}</p>}

      {result && (
        <div className="space-y-3 rounded bg-white p-4 shadow">
          <p>
            <b>{result.inserted}</b> added, <b>{result.updated}</b> updated, <b>{result.rejected}</b> rejected.
          </p>
          {result.errors.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-gray-100 text-left">
                <tr>
                  <th className="p-2">Row</th>
                  <th className="p-2">Phone</th>
                  <th className="p-2">Problem</th>
                </tr>
              </thead>
              <tbody>
                {result.errors.map((err) => (
                  <tr key={err.row} className="border-t">
                    <td className="p-2">{err.row}</td>
                    <td className="p-2">{err.phone}</td>
                    <td className="p-2 text-red-700">{err.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div>
        <h2 className="mb-2 text-lg font-medium">Classes</h2>
        {classes === null && !error && <p className="text-gray-500">Loading...</p>}
        {classes?.length === 0 && <p className="text-gray-500">No parents yet.</p>}
        {classes && classes.length > 0 && (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {classes.map((c) => (
              <li key={c.class_name} className="rounded bg-white px-3 py-2 text-sm shadow">
                <b>{c.class_name}</b>: {c.parent_count} parents
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
