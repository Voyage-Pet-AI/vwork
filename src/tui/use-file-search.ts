import { useState, useEffect } from "react";

const SKIP_PREFIXES = ["node_modules/", ".git/", "dist/"];
const MAX_RESULTS = 10;

export function useFileSearch(query: string | null): { files: string[]; loading: boolean } {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query === null || query === "") {
      setFiles([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const glob = new Bun.Glob(`**/*${query}*`);
        const results: string[] = [];

        for await (const path of glob.scan({ cwd: process.cwd(), dot: false })) {
          if (cancelled) return;
          if (SKIP_PREFIXES.some((p) => path.startsWith(p))) continue;
          results.push(path);
          if (results.length >= MAX_RESULTS) break;
        }

        if (!cancelled) {
          setFiles(results);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setFiles([]);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [query]);

  return { files, loading };
}
