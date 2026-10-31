"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { placeholderNumbers } from "@/lib/templates";
import type { Template } from "@/lib/types";

const LANGUAGES = ["en", "hi", "ta", "te", "kn", "mr", "bn", "gu", "ml"];

// useSearchParams needs a Suspense boundary in Next.js.
export default function NewTemplatePage() {
  return (
    <Suspense fallback={<p className="text-gray-500">Loading...</p>}>
      <TemplateForm />
    </Suspense>
  );
}

function TemplateForm() {
  const router = useRouter();
  const fromId = useSearchParams().get("from"); // set when editing a rejected template

  const [loading, setLoading] = useState(!!fromId);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en");
  const [category, setCategory] = useState<"UTILITY" | "MARKETING">("UTILITY");
  const [body, setBody] = useState("");
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [hasButtons, setHasButtons] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Prefill from the old template when resubmitting.
  useEffect(() => {
    if (!fromId) return;
    api<Template[]>("/api/templates")
      .then((all) => {
        const old = all.find((t) => t.id === fromId);
        if (!old) {
          setErrors(["Template not found."]);
          return;
        }
        setName(old.name);
        setLanguage(old.language);
        setCategory(old.category);
        setBody(old.body);
        setLabels(Object.fromEntries(old.variable_names.map((v, i) => [String(i + 1), v])));
        setSamples(old.sample_values);
        setHasButtons(old.has_confirm_buttons);
      })
      .catch((e) => setErrors([e.message]))
      .finally(() => setLoading(false));
  }, [fromId]);

  const numbers = placeholderNumbers(body);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors([]);

    const content = {
      category,
      body,
      variable_names: numbers.map((n) => labels[String(n)] ?? ""),
      sample_values: Object.fromEntries(numbers.map((n) => [String(n), samples[String(n)] ?? ""])),
      has_confirm_buttons: hasButtons,
    };
    try {
      if (fromId) {
        await api(`/api/templates/${fromId}/resubmit`, { method: "POST", body: JSON.stringify(content) });
      } else {
        await api("/api/templates", { method: "POST", body: JSON.stringify({ ...content, name, language }) });
      }
      router.push("/templates");
    } catch (e) {
      setErrors(e instanceof ApiError ? e.errors : [(e as Error).message]);
      setSaving(false);
    }
  }

  if (loading) return <p className="text-gray-500">Loading...</p>;

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-5">
      <h1 className="text-2xl font-semibold">{fromId ? "Edit and resubmit template" : "Request new template"}</h1>

      {fromId ? (
        <p className="text-sm text-gray-600">
          Submitted templates can&apos;t be changed, so this is saved as a new version of <b>{name}</b> ({language}).
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium">Name</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ptm_reminder"
              className="mt-1 w-full rounded border px-3 py-2"
            />
            <span className="text-xs text-gray-500">Lowercase letters, digits and underscores only.</span>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Language</span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="mt-1 w-full rounded border bg-white px-3 py-2"
            >
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      <label className="block">
        <span className="text-sm font-medium">Category</span>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as "UTILITY" | "MARKETING")}
          className="mt-1 w-full rounded border bg-white px-3 py-2"
        >
          <option value="UTILITY">UTILITY (notices, reminders)</option>
          <option value="MARKETING">MARKETING</option>
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium">Message</span>
        <textarea
          required
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Dear parent, the PTM is on {{1}} at {{2}} in {{3}}. Please confirm your attendance."
          className="mt-1 w-full rounded border px-3 py-2"
        />
        <span className="text-xs text-gray-500">
          Use {"{{1}}"}, {"{{2}}"} ... for the parts that change. Don&apos;t start or end with one, and
          don&apos;t put two next to each other.
        </span>
      </label>

      {numbers.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">Placeholders</p>
          {numbers.map((n) => (
            <div key={n} className="grid grid-cols-[3rem_1fr_1fr] items-center gap-3">
              <span className="text-sm text-gray-600">{`{{${n}}}`}</span>
              <input
                value={labels[String(n)] ?? ""}
                onChange={(e) => setLabels({ ...labels, [String(n)]: e.target.value })}
                placeholder="Label, e.g. date"
                className="rounded border px-3 py-2"
              />
              <input
                value={samples[String(n)] ?? ""}
                onChange={(e) => setSamples({ ...samples, [String(n)]: e.target.value })}
                placeholder="Sample, e.g. 12 Nov"
                className="rounded border px-3 py-2"
              />
            </div>
          ))}
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={hasButtons} onChange={(e) => setHasButtons(e.target.checked)} />
        Add &quot;Confirm&quot; and &quot;Can&apos;t attend&quot; buttons
      </label>

      {errors.length > 0 && (
        <ul className="list-disc space-y-1 rounded bg-red-50 p-3 pl-8 text-sm text-red-700">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}

      <button type="submit" disabled={saving} className="rounded bg-blue-600 px-5 py-2 text-white disabled:opacity-50">
        {saving ? "Submitting..." : "Submit to WhatsApp"}
      </button>
    </form>
  );
}
