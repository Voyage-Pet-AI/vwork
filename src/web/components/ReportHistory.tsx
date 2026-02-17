import { useState, useEffect, useCallback } from "react";
import { getReportHistory, getReport, runReport } from "../lib/api.js";
import { ReportViewer } from "./ReportViewer.js";

export function ReportHistory() {
  const [reports, setReports] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await getReportHistory();
      setReports(data.reports);
    } catch {
      // best effort
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSelect = useCallback(async (filename: string) => {
    setSelected(filename);
    try {
      const data = await getReport(filename);
      setContent(data.content);
    } catch {
      setContent("Failed to load report.");
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const result = await runReport();
      await refresh();
      if (result.savedPath) {
        const filename = result.savedPath.split("/").pop()!;
        handleSelect(filename);
      }
    } catch {
      // best effort
    } finally {
      setGenerating(false);
    }
  }, [refresh, handleSelect]);

  if (selected) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
          <button
            onClick={() => { setSelected(null); setContent(""); }}
            className="text-zinc-400 hover:text-zinc-200 text-sm"
          >
            ← Back
          </button>
          <span className="text-sm text-zinc-300 font-medium">{selected}</span>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <ReportViewer content={content} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">Reports</h2>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="px-4 py-2 bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg text-sm font-medium hover:bg-blue-600/30 transition-colors disabled:opacity-50"
        >
          {generating ? "Generating..." : "Generate Report"}
        </button>
      </div>
      {loading ? (
        <p className="text-zinc-500 text-sm">Loading...</p>
      ) : reports.length === 0 ? (
        <p className="text-zinc-500 text-sm">No reports yet. Generate one to get started.</p>
      ) : (
        <div className="space-y-1">
          {reports.map((r) => (
            <button
              key={r}
              onClick={() => handleSelect(r)}
              className="w-full text-left px-4 py-3 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800/60 transition-colors border border-transparent hover:border-zinc-700/50"
            >
              {r.replace(".md", "")}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
