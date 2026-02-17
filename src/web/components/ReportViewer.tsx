interface ReportViewerProps {
  content: string;
}

export function ReportViewer({ content }: ReportViewerProps) {
  return (
    <div className="prose prose-invert prose-sm max-w-none">
      <pre className="whitespace-pre-wrap text-sm text-zinc-300 leading-relaxed font-sans">
        {content}
      </pre>
    </div>
  );
}
