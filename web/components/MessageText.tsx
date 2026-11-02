// Renders a template body. Filled placeholders show their value; empty ones show a highlighted label.
export default function MessageText({ body, values = {}, labels = [] }: { body: string; values?: Record<string, string>; labels?: string[] }) {
  const parts = body.split(/(\{\{\d+\}\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\{\{(\d+)\}\}$/);
        if (!match) return <span key={i}>{part}</span>;
        const value = values[match[1]]?.trim();
        if (value) return <span key={i} className="font-medium">{value}</span>;
        return (
          <span key={i} className="rounded bg-amber-100 px-1 font-medium text-amber-800">
            {labels[Number(match[1]) - 1] || `{{${match[1]}}}`}
          </span>
        );
      })}
    </>
  );
}
