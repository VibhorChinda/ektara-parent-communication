"use client";

import { useEffect, useState } from "react";
import AudiencePicker from "@/components/AudiencePicker";
import GroupActions from "@/components/GroupActions";
import Icon from "@/components/Icon";
import ParentDrawer from "@/components/ParentDrawer";
import { useToast } from "@/components/Toast";
import { Alert, Button, Card, Chip, EmptyState, PageHeader, SearchInput, SkeletonRows } from "@/components/ui";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/format";
import { audienceLabel, inAudience, levelName, type GroupLike } from "@/lib/groups";
import { languageName } from "@/lib/templates";
import type { Audience, Parent } from "@/lib/types";

type UploadResult = {
  inserted: number;
  updated: number;
  rejected: number;
  errors: { row: number; phone: string | null; reason: string }[];
};

const COLUMNS = ["parent_name", "phone", "child_name", "institution", "institution_type", "class_or_year", "section", "language", "has_whatsapp"];
const SAMPLE_ROWS = [
  ["Asha Sharma", "9876543210", "Rohan Sharma", "Sunrise Public School", "school", "7", "B", "hi", "yes"],
  ["John Mathew", "+91 98450 12345", "Anna Mathew", "Sunrise Public School", "school", "7", "B", "en", "no"],
  ["Meera Iyer", "9840012345", "Karthik Iyer", "City Engineering College", "college", "2", "", "ta", "yes"],
];

// Answered nothing in 2+ campaigns: worth a personal call.
function hardToReach(p: Parent): boolean {
  return p.stats.total >= 2 && p.stats.responded === 0;
}

export default function ParentsPage() {
  const toast = useToast();
  const [parents, setParents] = useState<Parent[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState("");
  const [audience, setAudience] = useState<Audience | null>(null);
  const [onlyHardToReach, setOnlyHardToReach] = useState(false);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  function loadParents() {
    api<Parent[]>("/api/parents")
      .then(setParents)
      .catch((e) => setLoadError(e.message));
  }

  useEffect(loadParents, []);

  function pickFile(f: File | undefined) {
    setResult(null);
    setError("");
    if (f && !f.name.toLowerCase().endsWith(".csv")) {
      setError("Please choose a .csv file. In Excel or Google Sheets use File → Download → CSV.");
      return;
    }
    setFile(f ?? null);
  }

  async function upload() {
    if (!file || uploading) return;
    setUploading(true);
    setError("");
    setResult(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await api<UploadResult>("/api/parents/upload", { method: "POST", body: form });
      setResult(res);
      setFile(null);
      toast(`${res.inserted + res.updated} parents saved`);
      loadParents();
    } catch (e) {
      setError((e as Error).message);
    }
    setUploading(false);
  }

  const all = parents ?? [];
  const groups: GroupLike[] = all.map((p) => ({ ...p, count: 1 }));
  const institutions = Array.from(new Set(all.map((p) => p.institution))).sort();
  const q = query.trim().toLowerCase();
  const inGroup = all.filter((p) => inAudience(p, audience));
  const shown = inGroup.filter(
    (p) =>
      (!onlyHardToReach || hardToReach(p)) &&
      (!q || [p.parent_name, p.child_name ?? "", p.phone_e164].some((v) => v.toLowerCase().includes(q))),
  );
  const hardCount = inGroup.filter(hardToReach).length;
  const audienceType = all.find((p) => p.institution === audience?.institution)?.institution_type ?? "school";
  const openParent = all.find((p) => p.id === openId) ?? null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Parents"
        description="Upload your lists. Parents with the same phone number are updated, not duplicated."
        actions={
          <Button variant="secondary" onClick={() => downloadCsv("parents-sample.csv", [COLUMNS, ...SAMPLE_ROWS])}>
            <Icon name="download" /> Sample CSV
          </Button>
        }
      />

      <section className="space-y-4">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pickFile(e.dataTransfer.files[0]);
          }}
          className={`flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
            dragging ? "border-zinc-900 bg-zinc-100" : "border-zinc-300 bg-white hover:border-zinc-400"
          }`}
        >
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
              e.target.value = ""; // allow picking the same file again
            }}
          />
          <span className="mb-3 rounded-full bg-zinc-100 p-3 text-zinc-500">
            <Icon name="upload" className="size-6" />
          </span>
          {file ? (
            <>
              <span className="font-medium">{file.name}</span>
              <span className="text-xs text-zinc-500">{(file.size / 1024).toFixed(1)} KB &middot; click to choose another</span>
            </>
          ) : (
            <>
              <span className="font-medium">Drop a CSV here, or click to choose</span>
              <span className="mt-1 max-w-xl text-xs text-zinc-500">
                Columns: <code className="font-mono">{COLUMNS.join(", ")}</code>. Use institution_type <code>school</code> (class + section)
                or <code>college</code> (year 1–4, no section).
              </span>
            </>
          )}
        </label>

        {file && (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFile(null)} disabled={uploading}>Cancel</Button>
            <Button onClick={upload} loading={uploading}>{uploading ? "Uploading..." : "Upload parents"}</Button>
          </div>
        )}

        {error && <Alert>{error}</Alert>}
        {result && <UploadReport result={result} />}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Directory {parents && <span className="text-sm font-normal text-zinc-400">{parents.length} parents</span>}
          </h2>
          <SearchInput value={query} onChange={setQuery} placeholder="Search name or phone" />
        </div>

        {loadError && <Alert>{loadError}</Alert>}
        {!loadError && parents === null && <SkeletonRows />}
        {parents?.length === 0 && (
          <EmptyState icon="users" title="No parents yet" description="Upload a CSV above to add your first school or college." />
        )}

        {parents && parents.length > 0 && (
          <>
            <Card className="space-y-4 p-4">
              <AudiencePicker groups={groups} value={audience} onChange={setAudience} allowAll />
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-3">
                <Chip active={onlyHardToReach} onClick={() => setOnlyHardToReach(!onlyHardToReach)} count={hardCount}>
                  Hard to reach
                </Chip>
                {audience && (
                  <GroupActions
                    key={audienceLabel(audience, audienceType)}
                    audience={audience}
                    type={audienceType}
                    count={inGroup.length}
                    onDone={() => {
                      setAudience(null);
                      loadParents();
                    }}
                  />
                )}
              </div>
            </Card>

            {shown.length === 0 ? (
              <p className="py-10 text-center text-sm text-zinc-500">No parents match.</p>
            ) : (
              <Card className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Parent</th>
                      <th className="px-4 py-3 font-medium">Group</th>
                      <th className="px-4 py-3 font-medium">Phone</th>
                      <th className="px-4 py-3 font-medium">Language</th>
                      <th className="px-4 py-3 font-medium">Reached by</th>
                      <th className="px-4 py-3 font-medium">Answered</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {shown.map((p) => (
                      <tr key={p.id} onClick={() => setOpenId(p.id)} className={`cursor-pointer hover:bg-zinc-50 ${p.opted_out ? "text-zinc-400" : ""}`}>
                        <td className="px-4 py-3">
                          <p className="font-medium">{p.parent_name}</p>
                          {p.child_name && <p className="text-xs text-zinc-500">Parent of {p.child_name}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-xs text-zinc-500">{p.institution}</p>
                          <p className="text-xs font-medium text-zinc-700">
                            {levelName(p.institution_type)} {p.class_or_year}
                            {p.section && ` · ${p.section}`}
                          </p>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{p.phone_e164}</td>
                        <td className="px-4 py-3 text-zinc-600">{languageName(p.language)}</td>
                        <td className="px-4 py-3">
                          {p.opted_out ? (
                            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500">Opted out</span>
                          ) : p.has_whatsapp ? (
                            <span className="text-xs text-emerald-700">WhatsApp, then call</span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-zinc-600"><Icon name="phone" className="size-3.5" /> Call only</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {p.stats.total === 0 ? (
                            <span className="text-zinc-400">No messages yet</span>
                          ) : (
                            <span className={hardToReach(p) ? "font-medium text-red-600" : "text-zinc-600"}>
                              {p.stats.responded} of {p.stats.total}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </>
        )}
      </section>

      <ParentDrawer
        parent={openParent}
        institutions={institutions}
        onClose={() => setOpenId(null)}
        onSaved={(updated) => setParents((list) => (list ?? []).map((p) => (p.id === updated.id ? updated : p)))}
        onDeleted={(id) => {
          setOpenId(null);
          setParents((list) => (list ?? []).filter((p) => p.id !== id));
        }}
      />
    </div>
  );
}

function UploadReport({ result }: { result: UploadResult }) {
  const stats = [
    { label: "Added", value: result.inserted, color: "text-emerald-700" },
    { label: "Updated", value: result.updated, color: "text-zinc-900" },
    { label: "Rejected", value: result.rejected, color: result.rejected ? "text-red-600" : "text-zinc-900" },
  ];
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-3 divide-x divide-zinc-100">
        {stats.map((s) => (
          <div key={s.label} className="p-4 text-center">
            <p className={`text-2xl font-semibold tabular-nums ${s.color}`}>{s.value}</p>
            <p className="text-xs text-zinc-500">{s.label}</p>
          </div>
        ))}
      </div>
      {result.errors.length > 0 && (
        <div className="border-t border-zinc-100">
          <div className="flex items-center justify-between px-4 py-3">
            <p className="text-sm font-medium">Rows that need fixing</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => downloadCsv("upload-errors.csv", [["Row", "Phone", "Problem"], ...result.errors.map((e) => [e.row, e.phone, e.reason])])}
            >
              <Icon name="download" className="size-3.5" /> Download
            </Button>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-zinc-100">
              {result.errors.map((err) => (
                <tr key={err.row}>
                  <td className="w-20 px-4 py-2 text-xs text-zinc-400">Row {err.row}</td>
                  <td className="px-4 py-2 font-mono text-xs">{err.phone || "—"}</td>
                  <td className="px-4 py-2 text-red-700">{err.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
