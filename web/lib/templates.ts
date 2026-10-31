// The sorted, unique placeholder numbers in a template body: "{{2}} {{1}}" -> [1, 2]
export function placeholderNumbers(body: string): number[] {
  const numbers = Array.from(body.matchAll(/\{\{(\d+)\}\}/g), (m) => Number(m[1]));
  return Array.from(new Set(numbers)).sort((a, b) => a - b);
}

// Replace {{n}} with values[n]; empty values show as [label].
export function fillTemplate(body: string, values: Record<string, string>, labels: string[] = []): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => {
    const value = values[n]?.trim();
    return value || `[${labels[Number(n) - 1] || n}]`;
  });
}
