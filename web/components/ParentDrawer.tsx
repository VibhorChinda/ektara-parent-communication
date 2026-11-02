"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import StatusBadge from "./StatusBadge";
import { useToast } from "./Toast";
import { Alert, Button, Drawer, Field, inputClass, Skeleton } from "./ui";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { levelName } from "@/lib/groups";
import { LANGUAGES } from "@/lib/templates";
import type { HistoryItem, InstitutionType, Parent } from "@/lib/types";

type Props = {
  parent: Parent | null;
  institutions: string[];
  onClose: () => void;
  onSaved: (parent: Parent) => void;
  onDeleted: (id: string) => void;
};

export default function ParentDrawer({ parent, institutions, onClose, onSaved, onDeleted }: Props) {
  return (
    <Drawer open={!!parent} title={parent?.parent_name ?? ""} subtitle={parent?.phone_e164} onClose={onClose}>
      {/* key: start with fresh form state for each parent */}
      {parent && <ParentForm key={parent.id} parent={parent} institutions={institutions} onSaved={onSaved} onDeleted={onDeleted} />}
    </Drawer>
  );
}

function ParentForm({ parent, institutions, onSaved, onDeleted }: Omit<Props, "parent" | "onClose"> & { parent: Parent }) {
  const toast = useToast();
  const [form, setForm] = useState({
    parent_name: parent.parent_name,
    phone: parent.phone_e164,
    child_name: parent.child_name ?? "",
    institution: parent.institution,
    institution_type: parent.institution_type,
    class_or_year: parent.class_or_year,
    section: parent.section ?? "",
    language: parent.language,
    has_whatsapp: parent.has_whatsapp,
    opted_out: parent.opted_out,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);

  useEffect(() => {
    api<HistoryItem[]>(`/api/parents/${parent.id}/history`)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [parent.id]);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body = { ...form, section: form.institution_type === "college" ? "" : form.section };
      const updated = await api<Parent>(`/api/parents/${parent.id}`, { method: "PATCH", body: JSON.stringify(body) });
      onSaved({ ...updated, stats: parent.stats });
      toast("Parent saved");
    } catch (e) {
      setError((e as Error).message);
    }
    setSaving(false);
  }

  async function remove() {
    setDeleting(true);
    try {
      await api(`/api/parents/${parent.id}`, { method: "DELETE" });
      onDeleted(parent.id);
      toast("Parent deleted");
    } catch (e) {
      setError((e as Error).message);
      setDeleting(false);
    }
  }

  const level = levelName(form.institution_type);
  const { total, responded, flagged } = parent.stats;

  return (
    <div className="space-y-8">
      {total > 0 && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Messages" value={total} />
          <Stat label="Answered" value={responded} />
          <Stat label="No answer" value={flagged} alert={flagged > 0} />
        </div>
      )}

      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Parent name">
            <input required value={form.parent_name} onChange={(e) => set("parent_name", e.target.value)} className={inputClass} />
          </Field>
          <Field label="Child name">
            <input value={form.child_name} onChange={(e) => set("child_name", e.target.value)} className={inputClass} />
          </Field>
          <Field label="Phone">
            <input required value={form.phone} onChange={(e) => set("phone", e.target.value)} className={`${inputClass} font-mono`} />
          </Field>
          <Field label="Language">
            <select value={form.language} onChange={(e) => set("language", e.target.value)} className={inputClass}>
              {Object.entries(LANGUAGES).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              {!LANGUAGES[form.language] && <option value={form.language}>{form.language}</option>}
            </select>
          </Field>
          <Field label="School or college">
            <input required list="institutions" value={form.institution} onChange={(e) => set("institution", e.target.value)} className={inputClass} />
            <datalist id="institutions">
              {institutions.map((i) => <option key={i} value={i} />)}
            </datalist>
          </Field>
          <Field label="Type">
            <select value={form.institution_type} onChange={(e) => set("institution_type", e.target.value as InstitutionType)} className={inputClass}>
              <option value="school">School</option>
              <option value="college">College</option>
            </select>
          </Field>
          {form.institution_type === "college" ? (
            <Field label="Year">
              <select value={form.class_or_year} onChange={(e) => set("class_or_year", e.target.value)} className={inputClass}>
                {!["1", "2", "3", "4"].includes(form.class_or_year) && <option value={form.class_or_year}>Choose a year</option>}
                {["1", "2", "3", "4"].map((y) => <option key={y} value={y}>Year {y}</option>)}
              </select>
            </Field>
          ) : (
            <Field label={level}>
              <input required value={form.class_or_year} onChange={(e) => set("class_or_year", e.target.value)} placeholder="e.g. 7 or LKG" className={inputClass} />
            </Field>
          )}
          {form.institution_type === "school" && (
            <Field label="Section" hint="Leave empty if the class has one section.">
              <input value={form.section} onChange={(e) => set("section", e.target.value)} placeholder="e.g. B" className={inputClass} />
            </Field>
          )}
        </div>

        <Toggle
          checked={form.has_whatsapp}
          onChange={(v) => set("has_whatsapp", v)}
          title="Has WhatsApp"
          text="Without WhatsApp the parent only gets the automatic phone call."
        />
        <Toggle
          checked={form.opted_out}
          onChange={(v) => set("opted_out", v)}
          title="Opted out"
          text="No WhatsApp messages and no calls. Parents can also reply STOP (and START to undo)."
        />

        {error && <Alert>{error}</Alert>}
        <div className="flex items-center justify-between gap-2">
          {confirmDelete ? (
            <span className="flex items-center gap-2 text-sm">
              Delete with their message history?
              <Button type="button" variant="danger" size="sm" loading={deleting} onClick={remove}>Delete</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Keep</Button>
            </span>
          ) : (
            <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)} className="text-red-600 hover:bg-red-50 hover:text-red-700">
              Delete parent
            </Button>
          )}
          <Button type="submit" loading={saving}>Save</Button>
        </div>
      </form>

      <section>
        <h3 className="mb-3 text-sm font-medium text-zinc-500">History</h3>
        {history === null && <Skeleton className="h-16 w-full" />}
        {history?.length === 0 && <p className="text-sm text-zinc-400">No messages sent to this parent yet.</p>}
        {history && history.length > 0 && (
          <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
            {history.map((h) => (
              <li key={h.id} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/campaigns/${h.campaigns.id}`} className="min-w-0 truncate font-medium hover:underline">
                    {h.campaigns.templates.name}
                  </Link>
                  <StatusBadge status={h.status} />
                </div>
                <p className="mt-0.5 text-xs text-zinc-400">{h.campaigns.audience} &middot; {formatDate(h.campaigns.created_at)}</p>
                {h.reply_text && <p className="mt-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-700">&ldquo;{h.reply_text}&rdquo;</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="rounded-lg bg-zinc-50 py-3">
      <p className={`text-lg font-semibold tabular-nums ${alert ? "text-red-600" : ""}`}>{value}</p>
      <p className="text-xs text-zinc-500">{label}</p>
    </div>
  );
}

function Toggle({ checked, onChange, title, text }: { checked: boolean; onChange: (v: boolean) => void; title: string; text: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 p-3 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-zinc-900" />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="text-xs text-zinc-500">{text}</span>
      </span>
    </label>
  );
}
