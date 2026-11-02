"use client";

import { Chip } from "./ui";
import { institutionsOf, levelName, levelsOf, sectionsOf, type GroupLike } from "@/lib/groups";
import type { Audience } from "@/lib/types";

// School -> class -> section, or college -> year. With allowAll, null means "everyone".
export default function AudiencePicker({
  groups,
  value,
  onChange,
  allowAll = false,
}: {
  groups: GroupLike[];
  value: Audience | null;
  onChange: (value: Audience | null) => void;
  allowAll?: boolean;
}) {
  const institutions = institutionsOf(groups);
  const total = groups.reduce((sum, g) => sum + g.count, 0);
  const current = institutions.find((i) => i.value === value?.institution);
  const levels = value ? levelsOf(groups, value.institution) : [];
  const sections = value?.class_or_year ? sectionsOf(groups, value.institution, value.class_or_year) : [];
  const level = levelName(current?.type ?? "school");

  return (
    <div className="space-y-3">
      <Row label="School or college">
        {allowAll && <Chip active={!value} onClick={() => onChange(null)} count={total}>All</Chip>}
        {institutions.map((i) => (
          <Chip
            key={i.value}
            active={value?.institution === i.value}
            onClick={() => onChange({ institution: i.value, class_or_year: null, section: null })}
            count={i.count}
          >
            {i.value}
            <span className="ml-1 font-normal opacity-60">{i.type === "college" ? "college" : "school"}</span>
          </Chip>
        ))}
      </Row>

      {value && levels.length > 0 && (
        <Row label={level}>
          <Chip active={!value.class_or_year} onClick={() => onChange({ ...value, class_or_year: null, section: null })}>
            All {level === "Year" ? "years" : "classes"}
          </Chip>
          {levels.map((l) => (
            <Chip
              key={l.value}
              active={value.class_or_year === l.value}
              onClick={() => onChange({ ...value, class_or_year: l.value, section: null })}
              count={l.count}
            >
              {level} {l.value}
            </Chip>
          ))}
        </Row>
      )}

      {value?.class_or_year && sections.length > 0 && (
        <Row label="Section">
          <Chip active={!value.section} onClick={() => onChange({ ...value, section: null })}>All sections</Chip>
          {sections.map((s) => (
            <Chip key={s.value} active={value.section === s.value} onClick={() => onChange({ ...value, section: s.value })} count={s.count}>
              {s.value}
            </Chip>
          ))}
        </Row>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
      <span className="w-32 shrink-0 pt-1 text-xs font-medium text-zinc-500">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}
