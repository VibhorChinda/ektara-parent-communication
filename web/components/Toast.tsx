"use client";

import { createContext, useCallback, useContext, useState } from "react";
import Icon from "./Icon";

type Tone = "success" | "error";
type Toast = { id: number; message: string; tone: Tone };

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {});

// Short confirmation messages in the corner, e.g. toast("Copied").
export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, tone: Tone = "success") => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm text-white shadow-lg"
          >
            <Icon name={t.tone === "success" ? "check" : "warning"} className={`size-4 ${t.tone === "success" ? "text-emerald-400" : "text-red-400"}`} />
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
