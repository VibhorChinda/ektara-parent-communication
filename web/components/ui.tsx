"use client";

import { useEffect } from "react";
import Icon, { type IconName } from "./Icon";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-zinc-900 text-white shadow-sm hover:bg-zinc-700",
  secondary: "border border-zinc-200 bg-white text-zinc-800 shadow-sm hover:bg-zinc-50",
  ghost: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
  danger: "bg-red-600 text-white shadow-sm hover:bg-red-500",
};

// Also used on <Link> so links can look like buttons.
export function buttonClass(variant: Variant = "primary", size: Size = "md"): string {
  const sizing = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-4 py-2 text-sm";
  return `inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${VARIANTS[variant]}`;
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

export function Button({ variant = "primary", size = "md", loading = false, className = "", disabled, children, ...props }: ButtonProps) {
  return (
    <button {...props} disabled={disabled || loading} className={`${buttonClass(variant, size)} ${className}`}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
    />
  );
}

export const inputClass =
  "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm transition placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-4 focus:ring-zinc-100";

export function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`rounded-xl border border-zinc-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon: IconName; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-14 text-center">
      <div className="mb-3 rounded-full bg-zinc-100 p-3 text-zinc-500">
        <Icon name={icon} className="size-6" />
      </div>
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-zinc-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

const ALERT_TONES = {
  error: "border-red-200 bg-red-50 text-red-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  info: "border-zinc-200 bg-zinc-50 text-zinc-700",
};

export function Alert({ tone = "error", children }: { tone?: keyof typeof ALERT_TONES; children: React.ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex gap-3 rounded-lg border px-4 py-3 text-sm ${ALERT_TONES[tone]}`}>
      <Icon name={tone === "success" ? "check" : "warning"} className="mt-0.5 size-4" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-zinc-200/70 ${className}`} />;
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <Card className="divide-y divide-zinc-100">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 p-4">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="ml-auto h-4 w-16" />
        </div>
      ))}
    </Card>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-zinc-800">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full sm:w-72">
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${inputClass} pl-9`}
      />
    </div>
  );
}

// Pill-style filter tabs: [{key, label, count}]
export function Tabs<K extends string>({ tabs, active, onChange }: { tabs: { key: K; label: string; count?: number }[]; active: K; onChange: (key: K) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-1" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
            active === t.key ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-900"
          }`}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-xs text-zinc-400">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/40 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl"
      >
        <div className="p-5">
          <h2 id="modal-title" className="text-base font-semibold">{title}</h2>
          <div className="mt-3 text-sm text-zinc-600">{children}</div>
        </div>
        {footer && <div className="flex justify-end gap-2 border-t border-zinc-100 bg-zinc-50 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
