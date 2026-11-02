export const LANGUAGES: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  ta: "Tamil",
  te: "Telugu",
  kn: "Kannada",
  mr: "Marathi",
  bn: "Bengali",
  gu: "Gujarati",
  ml: "Malayalam",
};

export function languageName(code: string): string {
  return LANGUAGES[code] ?? code;
}

export const MAX_BODY_LENGTH = 1024;

// The sorted, unique placeholder numbers in a template body: "{{2}} {{1}}" -> [1, 2]
export function placeholderNumbers(body: string): number[] {
  const numbers = Array.from(body.matchAll(/\{\{(\d+)\}\}/g), (m) => Number(m[1]));
  return Array.from(new Set(numbers)).sort((a, b) => a - b);
}

// Same body rules as the backend (routers/templates.py), so problems show while typing.
export function bodyProblems(rawBody: string, category: string): string[] {
  const body = rawBody.trim();
  if (!body) return [];
  const problems: string[] = [];
  const numbers = placeholderNumbers(body);
  const matches = body.match(/\{\{\d+\}\}/g) ?? [];

  if (body.length > MAX_BODY_LENGTH) problems.push(`Keep the message under ${MAX_BODY_LENGTH} characters.`);
  if (body.split("{{").length - 1 !== matches.length) problems.push("Placeholders must look exactly like {{1}}, {{2}} ...");
  if (numbers.some((n, i) => n !== i + 1)) problems.push("Number placeholders {{1}}, {{2}} ... with no gaps.");
  if (/^\{\{\d+\}\}/.test(body)) problems.push("The message can't start with a placeholder.");
  if (/\{\{\d+\}\}[\s.,!?:;]*$/.test(body)) problems.push("The message can't end with a placeholder. Add a few words after it.");
  if (/\}\}\s*\{\{/.test(body)) problems.push("Put some words between two placeholders.");
  if (category === "UTILITY" && /\b(offer|offers|discount|discounts|sale|sales)\b/i.test(body)) {
    problems.push("Utility templates can't use promotional words like offer, discount or sale.");
  }
  return problems;
}

// "PTM Reminder-2" -> "ptm_reminder_2"
export function toTemplateName(text: string): string {
  return text.toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
}
