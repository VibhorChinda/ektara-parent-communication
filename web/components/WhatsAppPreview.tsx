import MessageText from "./MessageText";

// Shows roughly how the message will look on the parent's phone.
export default function WhatsAppPreview({
  body,
  values,
  labels,
  hasButtons,
}: {
  body: string;
  values?: Record<string, string>;
  labels?: string[];
  hasButtons: boolean;
}) {
  return (
    <div className="rounded-xl bg-[#efeae2] p-4">
      <div className="max-w-[90%]">
        <div className="rounded-lg rounded-tl-none bg-white px-3 py-2 text-sm leading-relaxed text-zinc-800 shadow-sm">
          {body.trim() ? (
            <p className="whitespace-pre-wrap break-words">
              <MessageText body={body} values={values} labels={labels} />
            </p>
          ) : (
            <p className="italic text-zinc-400">Your message will appear here.</p>
          )}
        </div>
        {hasButtons && (
          <div className="mt-1 grid grid-cols-2 gap-1">
            <span className="rounded-lg bg-white py-2 text-center text-sm font-medium text-sky-600 shadow-sm">Confirm</span>
            <span className="rounded-lg bg-white py-2 text-center text-sm font-medium text-sky-600 shadow-sm">Can&apos;t attend</span>
          </div>
        )}
      </div>
    </div>
  );
}
