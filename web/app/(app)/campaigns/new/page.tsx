"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import AudiencePicker from "@/components/AudiencePicker";
import Icon from "@/components/Icon";
import WhatsAppPreview from "@/components/WhatsAppPreview";
import { Alert, Button, buttonClass, Card, EmptyState, Field, inputClass, Modal, PageHeader, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { languageVersions } from "@/lib/campaign";
import { formatMoney } from "@/lib/format";
import { audienceLabel, inAudience } from "@/lib/groups";
import { languageName, placeholderNumbers } from "@/lib/templates";
import type { AppInfo, Audience, Group, Template } from "@/lib/types";

// useSearchParams needs a Suspense boundary in Next.js.
export default function NewCampaignPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <CampaignForm />
    </Suspense>
  );
}

function CampaignForm() {
  const router = useRouter();
  const preselected = useSearchParams().get("template"); // from "Use in campaign" on the templates page
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [loadError, setLoadError] = useState("");

  const [audience, setAudience] = useState<Audience | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Only Meta-approved templates can be used for a campaign.
    Promise.all([
      api<Group[]>("/api/parents/groups"),
      api<Template[]>("/api/templates?status=approved"),
      api<AppInfo>("/api/info"),
    ])
      .then(([g, t, i]) => {
        setGroups(g);
        setTemplates(t);
        setInfo(i);
        if (preselected && t.some((x) => x.id === preselected)) setTemplateId(preselected);
      })
      .catch((e) => setLoadError(e.message));
  }, [preselected]);

  if (loadError) return <Alert>{loadError}</Alert>;
  if (!groups || !templates) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (groups.length === 0 || templates.length === 0) {
    return (
      <div>
        <PageHeader title="New campaign" />
        {groups.length === 0 ? (
          <EmptyState
            icon="users"
            title="No parents yet"
            description="Upload a CSV of parents first, then come back to send a campaign."
            action={<Link href="/parents" className={buttonClass("primary")}>Upload parents</Link>}
          />
        ) : (
          <EmptyState
            icon="doc"
            title="No approved templates yet"
            description="WhatsApp only allows messages that Meta has approved. Request a template and wait for approval."
            action={<Link href="/templates/new" className={buttonClass("primary")}>Request a template</Link>}
          />
        )}
      </div>
    );
  }

  const template = templates.find((t) => t.id === templateId);
  const numbers = template ? placeholderNumbers(template.body) : [];
  const missing = numbers.filter((n) => !values[String(n)]?.trim());

  // Who the campaign reaches, and in which language.
  const chosenGroups = audience ? groups.filter((g) => inAudience(g, audience)) : [];
  const parentCount = chosenGroups.reduce((sum, g) => sum + g.parent_count, 0);
  const whatsappCount = chosenGroups.reduce((sum, g) => sum + g.whatsapp_count, 0);
  const languages: Record<string, number> = {};
  for (const g of chosenGroups) {
    for (const [lang, n] of Object.entries(g.languages)) languages[lang] = (languages[lang] ?? 0) + n;
  }
  const versions = template ? languageVersions(template, templates) : {};
  const label = audience ? audienceLabel(audience, chosenGroups[0]?.institution_type ?? "school") : "";

  let blocker = "";
  if (!audience || parentCount === 0) blocker = "Choose who gets it";
  else if (!template) blocker = "Choose a template";
  else if (missing.length > 0) blocker = `Fill in ${missing.length === 1 ? "1 detail" : `${missing.length} details`}`;

  function chooseTemplate(id: string) {
    setTemplateId(id);
    setValues({});
  }

  async function send() {
    if (!template || !audience || sending) return;
    setSending(true);
    setError("");
    try {
      const result = await api<{ id: string }>("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({ template_id: template.id, ...audience, variables: values }),
      });
      router.push(`/campaigns/${result.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
      setConfirming(false);
    }
    // On success sending stays true so the button can't be pressed again.
  }

  return (
    <div>
      <PageHeader title="New campaign" description="Send an approved WhatsApp message to every parent in a class." />

      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="space-y-8">
          <Step number={1} title="Who should get it?" done={parentCount > 0}>
            <Card className="p-4">
              <AudiencePicker
                groups={groups.map((g) => ({ ...g, count: g.parent_count }))}
                value={audience}
                onChange={setAudience}
              />
            </Card>
            <p className="mt-2 text-xs text-zinc-400">Pick a whole school or college, one class or year, or one section.</p>
          </Step>

          <Step number={2} title="Which message?" done={!!template}>
            <div className="grid gap-2 sm:grid-cols-2">
              {templates.map((t) => (
                <OptionCard key={t.id} selected={templateId === t.id} onClick={() => chooseTemplate(t.id)}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{t.name}</span>
                    <span className="shrink-0 text-xs text-zinc-400">{languageName(t.language)}</span>
                  </span>
                  <span className="mt-1 line-clamp-2 text-xs text-zinc-500">{t.body}</span>
                </OptionCard>
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              Only Meta-approved templates are listed. <Link href="/templates/new" className="underline">Request a new one</Link>
            </p>
          </Step>

          <Step number={3} title="Fill in the details" done={!!template && missing.length === 0}>
            {!template ? (
              <p className="text-sm text-zinc-400">Choose a template first.</p>
            ) : numbers.length === 0 ? (
              <p className="text-sm text-zinc-500">This template has nothing to fill in.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {numbers.map((n) => (
                  <Field key={n} label={template.variable_names[n - 1] || `Value ${n}`}>
                    <input
                      value={values[String(n)] ?? ""}
                      onChange={(e) => setValues({ ...values, [String(n)]: e.target.value })}
                      placeholder={`e.g. ${template.sample_values[String(n)] ?? ""}`}
                      className={inputClass}
                    />
                  </Field>
                ))}
              </div>
            )}
          </Step>
        </div>

        <div className="lg:sticky lg:top-6 lg:h-fit">
          <Card className="p-4">
            <p className="mb-3 text-sm font-medium text-zinc-500">Preview</p>
            <WhatsAppPreview
              body={template?.body ?? ""}
              values={values}
              labels={template?.variable_names}
              hasButtons={template?.has_confirm_buttons ?? false}
            />
            <dl className="mt-4 space-y-2 text-sm">
              <SummaryRow label="Recipients">{parentCount > 0 ? `${parentCount} parents` : "—"}</SummaryRow>
              {label && <SummaryRow label="Group">{label}</SummaryRow>}
              {template && Object.keys(languages).length > 0 && (
                <SummaryRow label="Languages">
                  {Object.entries(languages).map(([lang, n]) => (
                    <span key={lang} className="block">
                      {languageName(lang)} {n}
                      {!versions[lang] && <span className="text-amber-700"> (gets {languageName(template.language)})</span>}
                    </span>
                  ))}
                </SummaryRow>
              )}
              <SummaryRow label="No reply?">
                {info ? `Automatic call after ${info.call_fallback_hours} h (${info.call_window_start}–${info.call_window_end})` : "Automatic phone call later"}
              </SummaryRow>
              {info && info.cost_per_whatsapp > 0 && parentCount > 0 && (
                <SummaryRow label="Rough cost">
                  {formatMoney(whatsappCount * info.cost_per_whatsapp, info.currency)}
                  {info.cost_per_call > 0 && (
                    <span className="block text-xs text-zinc-500">
                      up to {formatMoney(whatsappCount * info.cost_per_whatsapp + parentCount * info.cost_per_call, info.currency)} if everyone needs a call
                    </span>
                  )}
                </SummaryRow>
              )}
            </dl>
            {error && <div className="mt-4"><Alert>{error}</Alert></div>}
            <Button onClick={() => setConfirming(true)} disabled={!!blocker || sending} className="mt-4 w-full">
              <Icon name="send" /> {blocker || "Review and send"}
            </Button>
          </Card>
        </div>
      </div>

      <Modal
        open={confirming}
        title={`Send to ${parentCount} parents in ${label}?`}
        onClose={() => !sending && setConfirming(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={sending}>Cancel</Button>
            <Button onClick={send} loading={sending}>{sending ? "Sending..." : "Send now"}</Button>
          </>
        }
      >
        <p className="mb-3">
          Parents with WhatsApp get this message ({whatsappCount}); the rest get a phone call. You can stop the campaign later, but sent messages can&apos;t be taken back.
        </p>
        {template && (
          <WhatsAppPreview body={template.body} values={values} labels={template.variable_names} hasButtons={template.has_confirm_buttons} />
        )}
      </Modal>
    </div>
  );
}

function Step({ number, title, done, children }: { number: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2.5 font-medium">
        <span className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold ${done ? "bg-emerald-500 text-white" : "bg-zinc-200 text-zinc-600"}`}>
          {done ? <Icon name="check" className="size-3.5" /> : number}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function OptionCard({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-xl border bg-white p-3 text-left text-sm shadow-sm transition hover:border-zinc-300 ${
        selected ? "border-zinc-900 ring-1 ring-zinc-900" : "border-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-zinc-500">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}
