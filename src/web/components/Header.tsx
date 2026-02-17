import { useState, useEffect } from "react";
import { getConfig, getMCPServers } from "../lib/api.js";

export function Header() {
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState("");
  const [servers, setServers] = useState<string[]>([]);

  useEffect(() => {
    getConfig().then((cfg: any) => {
      setModel(cfg.llm?.model ?? "");
      setProvider(cfg.llm?.provider ?? "");
    }).catch(() => {});
    getMCPServers().then((data) => setServers(data.servers)).catch(() => {});
  }, []);

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <span className="text-lg font-semibold tracking-tight">VWork</span>
        {provider && (
          <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded">
            {provider} / {model}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {servers.map((s, index) => (
          <span
            key={`${s}-${index}`}
            className="text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded"
          >
            {s}
          </span>
        ))}
      </div>
    </header>
  );
}
