import { placeholderNumbers } from "./templates";
import type { Template } from "./types";

// Same matching as the backend (routers/campaigns.py language_versions): approved templates with
// the same name (ignoring _v2...) and placeholders, newest per language. The chosen one wins for its language.
export function languageVersions(chosen: Template, approved: Template[]): Record<string, Template> {
  const base = (name: string) => name.replace(/_v\d+$/, "");
  const numbers = placeholderNumbers(chosen.body).join(",");
  const versions: Record<string, Template> = {};
  const newestFirst = [...approved].sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const t of newestFirst) {
    if (base(t.name) === base(chosen.name) && placeholderNumbers(t.body).join(",") === numbers && !versions[t.language]) {
      versions[t.language] = t;
    }
  }
  versions[chosen.language] = chosen;
  return versions;
}
