"use client";

import { useState } from "react";
import { useToast } from "./Toast";
import { Alert, Button, Field, inputClass, Modal } from "./ui";
import { api } from "@/lib/api";
import { audienceLabel, levelName } from "@/lib/groups";
import type { Audience, InstitutionType } from "@/lib/types";

// Year-end tools for the selected group: move it to a new class/year, or delete it.
export default function GroupActions({ audience, type, count, onDone }: { audience: Audience; type: InstitutionType; count: number; onDone: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<"move" | "delete" | null>(null);
  const [target, setTarget] = useState("");
  const [targetSection, setTargetSection] = useState(audience.section ?? "");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const label = audienceLabel(audience, type);
  const level = levelName(type);

  function reset() {
    setMode(null);
    setError("");
    setTarget("");
    setConfirmText("");
  }

  function close() {
    if (!busy) reset();
  }

  async function move() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ moved: number }>("/api/parents/move", {
        method: "POST",
        body: JSON.stringify({ source: audience, class_or_year: target, section: audience.section ? targetSection : null }),
      });
      toast(`${r.moved} parents moved`);
      setBusy(false);
      reset();
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ deleted: number }>("/api/parents/delete-group", { method: "POST", body: JSON.stringify(audience) });
      toast(`${r.deleted} parents deleted`);
      setBusy(false);
      reset();
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex gap-2">
        {audience.class_or_year && (
          <Button variant="secondary" size="sm" onClick={() => setMode("move")}>Move {audience.section ? "section" : level.toLowerCase()}</Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => setMode("delete")} className="text-red-600 hover:bg-red-50 hover:text-red-700">
          Delete group
        </Button>
      </div>

      <Modal
        open={mode === "move"}
        title={`Move ${label}`}
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>Cancel</Button>
            <Button onClick={move} loading={busy} disabled={!target.trim()}>Move {count} parents</Button>
          </>
        }
      >
        <div className="space-y-4">
          <p>For year-end promotion. Move the highest {level.toLowerCase()} first, so groups don&apos;t get mixed.</p>
          <Field label={`New ${level.toLowerCase()}`}>
            <input autoFocus value={target} onChange={(e) => setTarget(e.target.value)} placeholder={type === "college" ? "e.g. 3" : "e.g. 8"} className={inputClass} />
          </Field>
          {audience.section && (
            <Field label="New section" hint="Leave as it is to keep the same section.">
              <input value={targetSection} onChange={(e) => setTargetSection(e.target.value)} className={inputClass} />
            </Field>
          )}
          {error && <Alert>{error}</Alert>}
        </div>
      </Modal>

      <Modal
        open={mode === "delete"}
        title={`Delete ${label}?`}
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>Cancel</Button>
            <Button variant="danger" onClick={remove} loading={busy} disabled={confirmText !== "DELETE"}>Delete {count} parents</Button>
          </>
        }
      >
        <div className="space-y-4">
          <p>This removes {count} parents and their message history. It can&apos;t be undone.</p>
          <Field label="Type DELETE to confirm">
            <input autoFocus value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className={inputClass} />
          </Field>
          {error && <Alert>{error}</Alert>}
        </div>
      </Modal>
    </>
  );
}
