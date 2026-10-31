// Common Twilio / WhatsApp error codes in plain language. Errors are stored as "CODE: message".
const TWILIO_ERRORS: Record<string, string> = {
  "21211": "The phone number is not valid.",
  "21408": "Calling or messaging this country is not enabled in the Twilio account.",
  "21610": "The parent has unsubscribed from messages.",
  "63003": "This number does not seem to be on WhatsApp.",
  "63015": "This number has not joined the WhatsApp sandbox (testing only).",
  "63016": "WhatsApp only allows approved templates outside the 24-hour reply window.",
  "63018": "Too many messages at once (Twilio rate limit). Try again later.",
  "63024": "This number cannot receive WhatsApp messages.",
  "63049": "Meta chose not to deliver this message.",
};

export function plainError(raw: string | null): string {
  if (!raw) return "";
  const code = raw.split(":")[0].trim();
  return TWILIO_ERRORS[code] ?? raw;
}
