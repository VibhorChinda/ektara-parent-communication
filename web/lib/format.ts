export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return formatDate(iso);
}

export function percent(part: number, total: number): number {
  return total ? Math.round((part / total) * 100) : 0;
}

// Quote every cell; prefix formula-like cells so spreadsheets don't run them.
function csvCell(value: string | number | null | undefined): string {
  let text = String(value ?? "");
  if (/^[=@\t\r]/.test(text) || (/^[+-]/.test(text) && !/^\+\d+$/.test(text))) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
