"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { useToast } from "@/components/Toast";
import WhatsAppPreview from "@/components/WhatsAppPreview";
import { Alert, Button, Card, Field, inputClass, PageHeader, Skeleton } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { bodyProblems, LANGUAGES, MAX_BODY_LENGTH, placeholderNumbers, toTemplateName } from "@/lib/templates";
import type { Template } from "@/lib/types";

type Category = "UTILITY" | "MARKETING";

const CATEGORIES: { value: Category; title: string; text: string }[] = [
  { value: "UTILITY", title: "Utility", text: "Reminders and notices, like a PTM. Best for most school messages." },
  { value: "MARKETING", title: "Marketing", text: "Promotions, like an admission drive or a fee offer." },
];

// useSearchParams needs a Suspense boundary in Next.js.
export default function NewTemplatePage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <TemplateForm />
    </Suspense>
  );
}

function TemplateForm() {
  const router = useRouter();
  const toast = useToast();
  const fromId = useSearchParams().get("from"); // set when editing a rejected template
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [loading, setLoading] = useState(!!fromId);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en");
  const [category, setCategory] = useState<Category>("UTILITY");
  const [body, setBody] = useState("");
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [hasButtons, setHasButtons] = useState(true);
  const [rejectionReason, setRejectionReason] = useState("");
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
        setRejectionReason(old.rejection_reason ?? "");
      })
      .catch((e) => setErrors([e.message]))
      .finally(() => setLoading(false));
  }, [fromId]);

  const numbers = placeholderNumbers(body);
  const problems = bodyProblems(body, category);

  // Insert the next {{n}} where the cursor is.
  function insertPlaceholder() {
    const next = `{{${(numbers.at(-1) ?? 0) + 1}}}`;
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + next + body.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + next.length, start + next.length);
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (problems.length > 0 || saving) return;
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
      toast("Sent to Meta for approval");
      router.push("/templates");
    } catch (e) {
      setErrors(e instanceof ApiError ? e.errors : [(e as Error).message]);
      setSaving(false);
    }
  }

  if (loading) return <Skeleton className="h-96 w-full" />;

  // MessageText reads labels by position: labels[n - 1] is the label for {{n}}.
  const sampleLabels = Array.from({ length: numbers.at(-1) ?? 0 }, (_, i) => labels[String(i + 1)] || `{{${i + 1}}}`);

  return (
    <div>
      <Link href="/templates" className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900">
        <Icon name="back" /> Templates
      </Link>
      <PageHeader
        title={fromId ? "Edit and resubmit" : "Request a template"}
        description="It goes straight to Meta for approval. Once submitted it can't be changed, only replaced by a new version."
      />

      <form onSubmit={handleSubmit} className="grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {fromId && (
            <Alert tone="info">
              This is saved as a new version of <b>{name}</b> ({LANGUAGES[language] ?? language}).
              {rejectionReason && <> Meta rejected the last one: <i>{rejectionReason}</i></>}
            </Alert>
          )}

          {!fromId && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" hint="Lowercase letters, digits and underscores. Spaces become underscores.">
                <input
                  required
                  value={name}
                  onChange={(e) => setName(toTemplateName(e.target.value))}
                  placeholder="ptm_reminder"
                  className={`${inputClass} font-mono`}
                />
              </Field>
              <Field label="Language">
                <select value={language} onChange={(e) => setLanguage(e.target.value)} className={inputClass}>
                  {Object.entries(LANGUAGES).map(([code, label]) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-zinc-800">Category</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {CATEGORIES.map((c) => (
                <label
                  key={c.value}
                  className={`cursor-pointer rounded-xl border bg-white p-3 text-sm shadow-sm transition ${
                    category === c.value ? "border-zinc-900 ring-1 ring-zinc-900" : "border-zinc-200 hover:border-zinc-300"
                  }`}
                >
                  <input type="radio" name="category" value={c.value} checked={category === c.value} onChange={() => setCategory(c.value)} className="sr-only" />
                  <span className="block font-medium">{c.title}</span>
                  <span className="text-xs text-zinc-500">{c.text}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="body" className="text-sm font-medium text-zinc-800">Message</label>
              <button type="button" onClick={insertPlaceholder} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100">
                <Icon name="plus" className="size-3.5" /> Insert placeholder
              </button>
            </div>
            <textarea
              id="body"
              ref={bodyRef}
              required
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Dear parent, the PTM is on {{1}} at {{2}} in {{3}}. Please confirm your attendance."
              className={`${inputClass} leading-relaxed`}
            />
            <div className="mt-1.5 flex justify-between gap-4 text-xs text-zinc-500">
              <span>Placeholders like {"{{1}}"} are the parts you fill in for each campaign (a date, a time, a room).</span>
              <span className={`shrink-0 tabular-nums ${body.length > MAX_BODY_LENGTH ? "text-red-600" : ""}`}>
                {body.length}/{MAX_BODY_LENGTH}
              </span>
            </div>
            {problems.length > 0 && (
              <ul className="mt-2 space-y-1">
                {problems.map((p) => (
                  <li key={p} className="flex items-center gap-1.5 text-xs text-amber-700">
                    <Icon name="warning" className="size-3.5" /> {p}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {numbers.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-medium text-zinc-800">Placeholders</p>
              <p className="mb-3 text-xs text-zinc-500">
                The label is shown to admins when sending. Meta uses the sample to review the template.
              </p>
              <Card className="divide-y divide-zinc-100">
                {numbers.map((n) => (
                  <div key={n} className="grid items-center gap-3 p-3 sm:grid-cols-[3.5rem_1fr_1fr]">
                    <span className="font-mono text-xs font-medium text-amber-700">{`{{${n}}}`}</span>
                    <input
                      required
                      aria-label={`Label for {{${n}}}`}
                      value={labels[String(n)] ?? ""}
                      onChange={(e) => setLabels({ ...labels, [String(n)]: e.target.value })}
                      placeholder="Label, e.g. date"
                      className={inputClass}
                    />
                    <input
                      required
                      aria-label={`Sample for {{${n}}}`}
                      value={samples[String(n)] ?? ""}
                      onChange={(e) => setSamples({ ...samples, [String(n)]: e.target.value })}
                      placeholder="Sample, e.g. 12 Nov"
                      className={inputClass}
                    />
                  </div>
                ))}
              </Card>
            </div>
          )}

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-sm shadow-sm">
            <input type="checkbox" checked={hasButtons} onChange={(e) => setHasButtons(e.target.checked)} className="mt-0.5 size-4 accent-zinc-900" />
            <span>
              <span className="block font-medium">Add Confirm and Can&apos;t attend buttons</span>
              <span className="text-xs text-zinc-500">Parents answer with one tap. Without buttons they have to type a reply.</span>
            </span>
          </label>

          {errors.length > 0 && (
            <Alert>
              <ul className="list-disc space-y-1 pl-4">
                {errors.map((err) => <li key={err}>{err}</li>)}
              </ul>
            </Alert>
          )}
        </div>

        <div className="lg:sticky lg:top-6 lg:h-fit">
          <Card className="p-4">
            <p className="mb-3 text-sm font-medium text-zinc-500">Preview with samples</p>
            <WhatsAppPreview body={body} values={samples} labels={sampleLabels} hasButtons={hasButtons} />
            <Button type="submit" loading={saving} disabled={problems.length > 0} className="mt-4 w-full">
              {saving ? "Submitting..." : "Submit to Meta"}
            </Button>
            <p className="mt-2 text-center text-xs text-zinc-400">Approval usually takes 5 minutes to 24 hours.</p>
          </Card>
        </div>
      </form>
    </div>
  );
}
