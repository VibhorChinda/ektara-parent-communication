import type { Audience, InstitutionType } from "./types";

// Anything placed in the hierarchy: a parent, or a group with a count.
export type GroupLike = {
  institution: string;
  institution_type: InstitutionType;
  class_or_year: string;
  section: string | null;
  count: number;
};

export type Choice = { value: string; count: number };

// "2" before "10", "LKG" and "UKG" in name order.
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function levelName(type: InstitutionType): string {
  return type === "college" ? "Year" : "Class";
}

export function audienceLabel(a: Audience, type: InstitutionType): string {
  const parts = [a.institution];
  if (a.class_or_year) parts.push(`${levelName(type)} ${a.class_or_year}`);
  if (a.section) parts.push(`Section ${a.section}`);
  return parts.join(" · ");
}

export function inAudience(g: Omit<GroupLike, "count" | "institution_type">, a: Audience | null): boolean {
  if (!a) return true;
  if (g.institution !== a.institution) return false;
  if (a.class_or_year && g.class_or_year !== a.class_or_year) return false;
  if (a.section && g.section !== a.section) return false;
  return true;
}

function tally(values: (string | null)[], counts: number[]): Choice[] {
  const totals = new Map<string, number>();
  values.forEach((v, i) => {
    if (v) totals.set(v, (totals.get(v) ?? 0) + counts[i]);
  });
  return Array.from(totals, ([value, count]) => ({ value, count })).sort((a, b) => naturalCompare(a.value, b.value));
}

export function institutionsOf(groups: GroupLike[]): (Choice & { type: InstitutionType })[] {
  const types = new Map(groups.map((g) => [g.institution, g.institution_type]));
  return tally(groups.map((g) => g.institution), groups.map((g) => g.count)).map((c) => ({
    ...c,
    type: types.get(c.value) ?? "school",
  }));
}

export function levelsOf(groups: GroupLike[], institution: string): Choice[] {
  const inside = groups.filter((g) => g.institution === institution);
  return tally(inside.map((g) => g.class_or_year), inside.map((g) => g.count));
}

export function sectionsOf(groups: GroupLike[], institution: string, classOrYear: string): Choice[] {
  const inside = groups.filter((g) => g.institution === institution && g.class_or_year === classOrYear);
  return tally(inside.map((g) => g.section), inside.map((g) => g.count));
}
