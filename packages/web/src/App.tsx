import { useCallback, useState } from "react";

interface ImportSummary {
  observations: number;
  endpoints: number;
  inputs: number;
  hypotheses: number;
  graph: { nodes: number; edges: number };
  evidenceTip: string | null;
}

export default function App() {
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const text = await file.text();
      const res = await fetch("/api/import/har", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ har: text }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as ImportSummary;
      setSummary(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="app">
      <header className="header">
        <h1>SurfaceTrace</h1>
        <p className="tagline">
          Attack-surface graph + threat mapper. One variable at a time.
        </p>
      </header>

      <main className="main">
        <section className="panel dropzone">
          <h2>1. Import baseline traffic</h2>
          <p>Drop a HAR from Caido, Burp, or browser DevTools (authorized targets only).</p>
          <input
            type="file"
            accept=".har,application/json"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
          {busy && <p className="muted">Importing…</p>}
          {error && <p className="error">{error}</p>}
        </section>

        {summary && (
          <section className="panel stats">
            <h2>2. Attack surface inventory</h2>
            <ul>
              <li>
                <strong>{summary.observations}</strong> observations
              </li>
              <li>
                <strong>{summary.endpoints}</strong> endpoints
              </li>
              <li>
                <strong>{summary.inputs}</strong> inputs
              </li>
              <li>
                <strong>{summary.hypotheses}</strong> review hypotheses
              </li>
              <li>
                Graph: {summary.graph.nodes} nodes / {summary.graph.edges} edges
              </li>
              <li className="mono">Evidence tip: {summary.evidenceTip ?? "—"}</li>
            </ul>
            <p className="muted">
              Next: open the graph canvas and threat cards (coming in the next milestone).
            </p>
          </section>
        )}

        <section className="panel workflow">
          <h2>Discipline</h2>
          <ol>
            <li>Confirm authorized scope</li>
            <li>Browse normally / import HAR</li>
            <li>Review mapped endpoints, inputs, trust boundaries</li>
            <li>Form a hypothesis</li>
            <li>
              Change <em>one</em> variable</li>
            <li>Compare → investigate or move on</li>
            <li>Evidence stays append-only and hash-linked</li>
          </ol>
        </section>
      </main>
    </div>
  );
}
