import { plainError } from "./errors";
import { formatCallTime } from "./format";
import type { Message, MessageEvent } from "./types";

// One line explaining where a message stands.
export function messageDetails(m: Message): string {
  if (m.status === "confirmed" || m.status === "declined") {
    if (m.confirmed_via === "admin") return "Recorded by an admin";
    return m.confirmed_via === "voice" ? "Answered on the phone call" : "Answered on WhatsApp";
  }
  if (m.status === "cancelled") return m.parents.opted_out ? "Parent opted out" : "Campaign stopped before sending";
  if (m.call_status) return `Call: ${m.call_status.replace("-", " ")}`;
  if (m.call_requested_at) return "Calling now";
  if (m.call_due_at) {
    const base = m.wa_error ? `${plainError(m.wa_error)} ` : m.parents.has_whatsapp ? "" : "No WhatsApp. ";
    return `${base}Call ${formatCallTime(m.call_due_at)}`;
  }
  if (m.wa_error) return plainError(m.wa_error);
  if (m.status === "read") return "Read, no reply yet";
  return "";
}

// One line per raw Twilio / cron / admin event.
export function eventSummary(e: MessageEvent): string {
  const p = e.payload as Record<string, string | undefined>;
  switch (e.source) {
    case "whatsapp_status":
      return `WhatsApp: ${p.MessageStatus ?? "?"}${p.ErrorCode ? ` (error ${p.ErrorCode})` : ""}`;
    case "whatsapp_inbound":
      return `${p.ButtonPayload ? "Tapped" : "Replied"} “${p.Body ?? ""}”${p.recovered ? " (recovered)" : ""}`;
    case "voice_gather":
      return `Pressed ${p.Digits || "nothing"}`;
    case "voice_status":
      return `Call ${p.CallStatus ?? "?"}${p.CallDuration ? `, ${p.CallDuration} s` : ""}`;
    case "admin":
      return `Marked ${p.outcome} by ${p.by}`;
    case "cron":
      if (p.error) return `Error: ${p.error}`;
      if (p.recheck_status) return `Status re-checked with Twilio: ${p.recheck_status}`;
      return "Background job";
    default:
      return e.source;
  }
}
