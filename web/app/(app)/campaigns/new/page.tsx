"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fillTemplate, placeholderNumbers } from "@/lib/templates";
import type { ClassInfo, Template } from "@/lib/types";

export default function NewCampaignPage() {
  const router = useRouter();
  const [classes, setClasses] = useState<ClassInfo[] | null>(null);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [loadError, setLoadError] = useState("");

  const [className, setClassName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Only Meta-approved templates can be used for a campaign.
    Promise.all([
      api<ClassInfo[]>("/api/parents/classes"),
      api<Template[]>("/api/templates?status=approved"),
    ])
      .then(([c, t]) => {
        setClasses(c);
        setTemplates(t);
      })
      .catch((e) => setLoadError(e.message));
  }, []);

  const template = templates?.find((t) => t.id === templateId);
  const selectedClass = classes?.find((c) => c.class_name === className);
  const numbers = template ? placeholderNumbers(template.body) : [];
  const allFilled = numbers.every((n) => values[String(n)]?.trim());
  const canSend = !!template && !!selectedClass && allFilled && !sending;

  function chooseTemplate(id: string) {
    setTemplateId(id);
    setValues({});
  }

  async function send() {
    if (!template || !selectedClass) return;
    const ok = window.confirm(
      `Send to ${selectedClass.parent_count} parents in class ${selectedClass.class_name}?`,
    );
    if (!ok) return;

    setSending(true);
    setError("");
    try {
      const result = await api<{ id: string }>("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({ template_id: template.id, class_name: className, variables: values }),
      });
      router.push(`/campaigns/${result.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
    }
    // On success sending stays true so the button can't be pressed again.
  }

  if (loadError) return <p className="text-red-600">{loadError}</p>;
  if (!classes || !templates) return <p className="text-gray-500">Loading...</p>;

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-2xl font-semibold">New campaign</h1>

      {classes.length === 0 && <p className="text-gray-600">No parents yet. Upload parents first.</p>}
      {templates.length === 0 && (
        <p className="text-gray-600">No approved templates yet. Request one on the Templates page.</p>
      )}

      <label className="block">
        <span className="text-sm font-medium">Class</span>
        <select
          value={className}
          onChange={(e) => setClassName(e.target.value)}
          className="mt-1 w-full rounded border bg-white px-3 py-2"
        >
          <option value="">Choose a class</option>
          {classes.map((c) => (
            <option key={c.class_name} value={c.class_name}>
              {c.class_name} ({c.parent_count} parents)
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium">Template</span>
        <select
          value={templateId}
          onChange={(e) => chooseTemplate(e.target.value)}
          className="mt-1 w-full rounded border bg-white px-3 py-2"
        >
          <option value="">Choose an approved template</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.language})
            </option>
          ))}
        </select>
      </label>

      {template &&
        numbers.map((n) => (
          <label key={n} className="block">
            <span className="text-sm font-medium">{template.variable_names[n - 1] || `Value ${n}`}</span>
            <input
              value={values[String(n)] ?? ""}
              onChange={(e) => setValues({ ...values, [String(n)]: e.target.value })}
              placeholder={template.sample_values[String(n)]}
              className="mt-1 w-full rounded border px-3 py-2"
            />
          </label>
        ))}

      {template && (
        <div className="rounded border bg-white p-4">
          <p className="mb-2 text-xs uppercase text-gray-500">Preview</p>
          <p className="whitespace-pre-wrap">{fillTemplate(template.body, values, template.variable_names)}</p>
          {template.has_confirm_buttons && (
            <div className="mt-3 flex gap-2">
              <span className="rounded border px-3 py-1 text-sm text-blue-600">Confirm</span>
              <span className="rounded border px-3 py-1 text-sm text-blue-600">Can&apos;t attend</span>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-red-600">{error}</p>}

      <button
        onClick={send}
        disabled={!canSend}
        className="rounded bg-blue-600 px-5 py-2 text-white disabled:opacity-50"
      >
        {sending ? "Sending..." : "Send"}
      </button>
    </div>
  );
}
