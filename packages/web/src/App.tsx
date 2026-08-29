import { useState, type CSSProperties, type ReactNode } from "react";
import {
  curriculum,
  lessonById,
  trackNames,
  type Lesson,
  type SkillState,
} from "./lessons/curriculum";
import { recommendLessons } from "./lessons/recommend";
import "./inspector.css";

type View = "command" | "investigation" | "classroom" | "evidence";
interface Endpoint {
  id: string;
  method: string;
  host: string;
  pathTemplate: string;
  observationCount: number;
  statusCodes: number[];
}
interface Input {
  id: string;
  endpointId: string;
  name: string;
  location: string;
  sampleTypes: string[];
  sensitivity: string;
  observedCount: number;
}
interface Hypothesis {
  id: string;
  endpointId: string;
  question: string;
  signal: string;
  priority: number;
  status: string;
}
interface Observation {
  id: string;
  endpointId: string;
  url: string;
  method: string;
  responseStatus: number;
  responseSize: number;
  responseBodyShape: string | null;
  capturedAt: string;
  identityId: string | null;
  http?: {
    request: {
      httpVersion: string;
      target: string;
      headers: Record<string, string>;
      cookies: Record<string, string>;
      query: Record<string, string>;
      body: string | null;
    };
    response: {
      httpVersion: string;
      status: number;
      statusText: string;
      headers: Record<string, string>;
      body: string | null;
    };
  };
  parsedInputs?: {
    name: string;
    location: string;
    type: string;
    sensitive: boolean;
  }[];
}
interface Identity {
  id: string;
  label: string;
  role: "anonymous" | "user" | "admin" | "service" | "unknown";
  notes: string | null;
  associatedObservationIds: string[];
}
interface Evidence {
  id: string;
  kind: string;
  createdAt: string;
  contentHash: string;
  payload: unknown;
}
interface ExperimentRecord {
  id: string;
  endpointId: string;
  hypothesisId: string | null;
  baselineObservationId: string;
  resultObservationId: string;
  baselineIdentityId: string | null;
  resultIdentityId: string | null;
  mutationDescription: string;
  comparisonClassification: "controlled" | "observational";
  requestDifferences: string[];
  diff: DiffView;
  conclusion: string | null;
  notes: string | null;
  status: string;
  evidenceIds: string[];
  createdAt: string;
}
interface DiffView {
  summary: string;
  statusChanged?: boolean;
  statusFrom?: number;
  statusTo?: number;
  headerChanges?: string[];
  bodyComparison?: string;
  bodyChanges?: Array<{
    path: string;
    changeType: string;
    before: unknown;
    after: unknown;
  }>;
  bodyChangeCount?: number;
  truncated?: boolean;
  truncationReason?: string | null;
}
interface Inventory {
  observations: Observation[];
  endpoints: Endpoint[];
  inputs: Input[];
  hypotheses: Hypothesis[];
  evidence: Evidence[];
  identities: Identity[];
  experiments?: ExperimentRecord[];
}
const emptyInventory: Inventory = {
  observations: [],
  endpoints: [],
  inputs: [],
  hypotheses: [],
  evidence: [],
  identities: [],
  experiments: [],
};

export default function App() {
  const [view, setView] = useState<View>("command");
  const [inventory, setInventory] = useState<Inventory>(emptyInventory);
  const [endpointId, setEndpointId] = useState<string | null>(() =>
    localStorage.getItem("surfacetrace:endpoint"),
  );
  const [lessonId, setLessonId] = useState<string | null>(() =>
    localStorage.getItem("surfacetrace:lesson"),
  );
  const [returnView, setReturnView] = useState<View>("investigation");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skills, setSkills] = useState<Record<string, SkillState>>(() => {
    try {
      return JSON.parse(localStorage.getItem("surfacetrace:skills") ?? "{}");
    } catch {
      return {};
    }
  });
  const endpoint =
    inventory.endpoints.find((item) => item.id === endpointId) ??
    inventory.endpoints[0];
  const inputs = inventory.inputs.filter(
    (item) => item.endpointId === endpoint?.id,
  );
  const hypotheses = inventory.hypotheses.filter(
    (item) => item.endpointId === endpoint?.id,
  );
  const recommendations = endpoint
    ? recommendLessons({
        method: endpoint.method,
        inputLocations: inputs.map((item) => item.location),
        hypothesisSignals: hypotheses.map((item) => item.signal),
      })
    : [];

  function chooseEndpoint(id: string): void {
    setEndpointId(id);
    localStorage.setItem("surfacetrace:endpoint", id);
  }
  function openLesson(lesson: Lesson, from: View): void {
    setLessonId(lesson.id);
    setReturnView(from);
    setView("classroom");
    localStorage.setItem("surfacetrace:lesson", lesson.id);
  }
  function setSkill(id: string, state: SkillState): void {
    const next = { ...skills, [id]: state };
    setSkills(next);
    localStorage.setItem("surfacetrace:skills", JSON.stringify(next));
  }
  async function refreshInventory(): Promise<Inventory> {
    const response = await fetch("/api/inventory");
    if (!response.ok) throw new Error("Inventory could not be loaded");
    const next = (await response.json()) as Inventory;
    setInventory(next);
    return next;
  }
  async function importFile(file: File): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/import/har", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ har: await file.text() }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(body.error ?? `HTTP ${response.status}`);
      const refreshed = await refreshInventory();
      if (refreshed.endpoints[0]) chooseEndpoint(refreshed.endpoints[0].id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="masthead">
        <button className="brand" onClick={() => setView("command")}>
          SURFACE<span>TRACE</span>
        </button>
        <div className="investigation-name">
          <small>CURRENT INVESTIGATION</small>
          <strong>{endpoint?.host ?? "Awaiting authorized traffic"}</strong>
        </div>
        <div className="scope">
          <i /> SCOPE CONFIRMED
        </div>
      </header>
      <nav className="primary-nav" aria-label="Main navigation">
        {(["command", "investigation", "classroom", "evidence"] as View[]).map(
          (item) => (
            <button
              key={item}
              className={view === item ? "active" : ""}
              onClick={() => setView(item)}
            >
              {item === "command" ? "COMMAND CENTER" : item.toUpperCase()}
            </button>
          ),
        )}
      </nav>
      {view === "command" && (
        <CommandCenter
          inventory={inventory}
          endpoint={endpoint}
          inputs={inputs}
          recommendations={recommendations}
          busy={busy}
          error={error}
          onImport={importFile}
          onInvestigate={() => setView("investigation")}
          onLesson={(item) => openLesson(item, "command")}
        />
      )}
      {view === "investigation" && (
        <Investigation
          key={endpoint?.id ?? "empty"}
          inventory={inventory}
          current={endpoint}
          onChoose={chooseEndpoint}
          onSaved={refreshInventory}
          onLesson={(item) => openLesson(item, "investigation")}
          recommendations={recommendations}
        />
      )}
      {view === "classroom" && (
        <Classroom
          selected={lessonId ? lessonById(lessonId) : undefined}
          skills={skills}
          onOpen={(item) => openLesson(item, "classroom")}
          onSkill={setSkill}
          onReturn={() => setView(returnView)}
          recommendation={recommendations[0]}
        />
      )}
      {view === "evidence" && (
        <EvidenceView
          evidence={inventory.evidence}
          observations={inventory.observations}
        />
      )}
    </div>
  );
}

function CommandCenter({
  inventory,
  endpoint,
  inputs,
  recommendations,
  busy,
  error,
  onImport,
  onInvestigate,
  onLesson,
}: {
  inventory: Inventory;
  endpoint?: Endpoint;
  inputs: Input[];
  recommendations: ReturnType<typeof recommendLessons>;
  busy: boolean;
  error: string | null;
  onImport: (file: File) => void;
  onInvestigate: () => void;
  onLesson: (lesson: Lesson) => void;
}) {
  return (
    <main className="dashboard reveal">
      <section className="panel summary-panel">
        <PanelLabel number="01" label="ATTACK SURFACE" />
        <div className="metric-grid">
          <Metric value={inventory.endpoints.length} label="ENDPOINTS" />
          <Metric value={inventory.inputs.length} label="INPUTS" />
          <Metric value={inventory.hypotheses.length} label="HYPOTHESES" />
          <Metric value={inventory.evidence.length} label="EVIDENCE" />
        </div>
        <label className="import-control">
          <input
            type="file"
            accept=".har,application/json"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImport(file);
            }}
          />
          <span>{busy ? "NORMALIZING..." : "IMPORT AUTHORIZED HAR"}</span>
        </label>
        {error && <p className="error">{error}</p>}
      </section>
      <section className="panel focus-panel">
        <PanelLabel number="02" label="CURRENT FOCUS" />
        {endpoint ? (
          <>
            <div className="method-line">
              <b>{endpoint.method}</b>
              <code>{endpoint.pathTemplate}</code>
            </div>
            <p className="signal-copy">
              {inputs.some((item) => item.location === "path")
                ? "Object identifier observed in the request path."
                : "Endpoint selected for structured review."}
            </p>
            <button className="action" onClick={onInvestigate}>
              OPEN INVESTIGATION <span>-&gt;</span>
            </button>
          </>
        ) : (
          <Empty text="Import sample.har to establish an investigation focus." />
        )}
      </section>
      <section className="panel queue-panel">
        <PanelLabel number="03" label="INVESTIGATION QUEUE" />
        {inventory.hypotheses.slice(0, 4).map((item) => (
          <div className="queue-item" key={item.id}>
            <span className={item.priority >= 7 ? "risk high" : "risk medium"}>
              {item.priority >= 7 ? "HIGH" : "MED"}
            </span>
            <div>
              <strong>{item.signal.replaceAll("-", " ")}</strong>
              <small>HYPOTHESIS / NOT A FINDING</small>
            </div>
          </div>
        ))}
        {!inventory.hypotheses.length && (
          <Empty text="No hypotheses until traffic is imported." />
        )}
      </section>
      <section className="panel learning-panel">
        <PanelLabel number="04" label="RELATED LEARNING" />
        {recommendations[0] ? (
          <>
            <span className="eyebrow">RELATED SKILL</span>
            <h2>{recommendations[0].lesson.title}</h2>
            <p>{recommendations[0].why}</p>
            <div className="estimate">
              {recommendations[0].lesson.estimatedMinutes} MIN /{" "}
              {recommendations[0].lesson.level.toUpperCase()}
            </div>
            <button
              className="action coral"
              onClick={() => onLesson(recommendations[0]!.lesson)}
            >
              OPEN LESSON <span>-&gt;</span>
            </button>
          </>
        ) : (
          <Empty text="Contextual lessons appear after import." />
        )}
      </section>
      <section className="panel evidence-strip">
        <PanelLabel number="05" label="RECENT EVIDENCE" />
        <div className="evidence-row">
          <span>
            {inventory.observations.length
              ? "HASH CHAIN VALID"
              : "LEDGER READY"}
          </span>
          <code>
            {inventory.evidence.at(-1)?.contentHash.slice(0, 28) ??
              "No evidence records yet"}
          </code>
          <small>{inventory.observations.length} normalized observations</small>
        </div>
      </section>
    </main>
  );
}

function Investigation({
  inventory,
  current,
  onChoose,
  onSaved,
  onLesson,
  recommendations,
}: {
  inventory: Inventory;
  current?: Endpoint;
  onChoose: (id: string) => void;
  onSaved: () => Promise<unknown>;
  onLesson: (lesson: Lesson) => void;
  recommendations: ReturnType<typeof recommendLessons>;
}) {
  const inputs = inventory.inputs.filter(
    (item) => item.endpointId === current?.id,
  );
  const hypotheses = inventory.hypotheses.filter(
    (item) => item.endpointId === current?.id,
  );
  const observations = inventory.observations.filter(
    (item) => item.endpointId === current?.id,
  );
  const [hypothesisId, setHypothesisId] = useState("");
  const [baselineId, setBaselineId] = useState("");
  const [resultId, setResultId] = useState("");
  const [inputId, setInputId] = useState("");
  const [fromValue, setFromValue] = useState("");
  const [toValue, setToValue] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [experimentError, setExperimentError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{
    status: string;
    summary: string;
    evidenceCount: number;
    mutationDescription?: string;
    diff?: DiffView;
  } | null>(null);
  const [inspectorObservationId, setInspectorObservationId] = useState(
    observations[0]?.id ?? "",
  );
  const [inspectorTab, setInspectorTab] = useState<
    "request" | "response" | "parsed" | "diff"
  >("request");
  const selectedInput = inputs.find((item) => item.id === inputId);
  const inspected =
    observations.find((item) => item.id === inspectorObservationId) ??
    observations[0];
  const ready = Boolean(
    hypothesisId &&
      baselineId &&
      resultId &&
      inputId &&
      fromValue &&
      toValue &&
      baselineId !== resultId,
  );

  async function saveExperiment(): Promise<void> {
    if (!current || !selectedInput) return;
    setSaving(true);
    setExperimentError(null);
    setSaved(null);
    const detail = {
      name: selectedInput.name,
      from: fromValue || null,
      to: toValue || null,
    };
    const mutation =
      selectedInput.location === "path"
        ? {
            pathParam: {
              name: selectedInput.name,
              from: fromValue,
              to: toValue,
            },
          }
        : selectedInput.location === "query"
          ? { queryParam: detail }
          : ["header", "cookie"].includes(selectedInput.location)
            ? { header: detail }
            : {
                bodyField: {
                  path: selectedInput.name,
                  from: fromValue || null,
                  to: toValue || null,
                },
              };
    try {
      const response = await fetch("/api/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpointId: current.id,
          hypothesisId,
          baselineObservationId: baselineId,
          resultObservationId: resultId,
          inputId,
          mutation,
          notes,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        experiment?: { status: string; mutationDescription: string };
        diff?: DiffView;
        evidence?: unknown[];
      };
      if (!response.ok || !data.experiment || !data.diff)
        throw new Error(data.error ?? `HTTP ${response.status}`);
      setSaved({
        status: data.experiment.status,
        summary: data.diff.summary,
        evidenceCount: data.evidence?.length ?? 0,
        mutationDescription: data.experiment.mutationDescription,
        diff: data.diff,
      });
      await onSaved();
    } catch (reason) {
      setExperimentError(
        reason instanceof Error ? reason.message : String(reason),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="investigation-page reveal">
      <section className="graph-stage">
        <div className="graph-heading">
          <PanelLabel number="A" label="ATTACK SURFACE GRAPH" />
          <p>Click an endpoint node to establish focus.</p>
        </div>
        <div
          className="graph-canvas"
          role="group"
          aria-label="Attack surface graph"
        >
          {inventory.endpoints.map((item, index) => (
            <button
              key={item.id}
              style={{ "--node-index": index } as CSSProperties}
              className={`graph-node ${current?.id === item.id ? "selected" : ""}`}
              onClick={() => onChoose(item.id)}
            >
              <b>{item.method}</b>
              <span>{item.pathTemplate}</span>
              <small>{item.observationCount} observations</small>
            </button>
          ))}
          {current &&
            inputs.map((item) => (
              <div className="graph-input" key={item.id}>
                <span>{item.location}</span>
                {item.name}
              </div>
            ))}
        </div>
      </section>
      <section className="investigation-detail loop-detail">
        {current ? (
          <>
            <span className="eyebrow">CURRENT ENDPOINT</span>
            <h1>
              {current.method} {current.pathTemplate}
            </h1>
            <p className="host">
              {current.host} / status {current.statusCodes.join(", ")}
            </p>
            <HttpInspector
              observation={inspected}
              observations={observations}
              selectedId={inspectorObservationId}
              onSelect={setInspectorObservationId}
              tab={inspectorTab}
              onTab={setInspectorTab}
              diff={saved?.diff}
              identities={inventory.identities}
              onAssign={async (observationId, identityId) => {
                const response = await fetch(
                  `/api/observations/${observationId}/identity`,
                  {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ identityId }),
                  },
                );
                if (!response.ok)
                  throw new Error("Identity assignment could not be saved");
                await onSaved();
              }}
            />
            <IdentityComparison
              endpoint={current}
              observations={observations}
              identities={inventory.identities}
              hypothesisId={hypotheses[0]?.id}
              onSaved={onSaved}
            />
            <ExperimentNotebook
              experiments={inventory.experiments ?? []}
              endpoints={inventory.endpoints}
              hypotheses={inventory.hypotheses}
              observations={inventory.observations}
              identities={inventory.identities}
              onSaved={onSaved}
            />
            <h3>OBSERVED INPUTS</h3>
            <div className="input-table">
              {inputs.map((item) => (
                <div key={item.id}>
                  <span className={`location ${item.location}`}>
                    {item.location}
                  </span>
                  <strong>{item.name}</strong>
                  <code>{item.sampleTypes.join(" / ")}</code>
                  <small>{item.sensitivity}</small>
                </div>
              ))}
            </div>
            <div className="experiment-builder">
              <div className="builder-title">
                <span>CONTROLLED COMPARISON</span>
                <h2>Change one variable.</h2>
                <p>
                  Compare two imported observations. SurfaceTrace does not send
                  a request.
                </p>
              </div>
              <ExperimentStep
                n="01"
                title="CHOOSE HYPOTHESIS"
                complete={Boolean(hypothesisId)}
              >
                <div className="choice-list">
                  {hypotheses.map((item) => (
                    <button
                      className={hypothesisId === item.id ? "chosen" : ""}
                      key={item.id}
                      onClick={() => setHypothesisId(item.id)}
                    >
                      <b>PRIORITY {item.priority}</b>
                      <span>{item.question}</span>
                    </button>
                  ))}
                </div>
              </ExperimentStep>
              <ExperimentStep
                n="02"
                title="LOCK BASELINE"
                complete={Boolean(baselineId)}
              >
                <ObservationSelect
                  label="Baseline observation"
                  value={baselineId}
                  observations={observations}
                  onChange={setBaselineId}
                />
              </ExperimentStep>
              <ExperimentStep
                n="03"
                title="DECLARE ONE CHANGED INPUT"
                complete={Boolean(inputId && fromValue && toValue)}
              >
                <label>
                  Changed input
                  <select
                    value={inputId}
                    onChange={(event) => setInputId(event.target.value)}
                  >
                    <option value="">Select one input</option>
                    {inputs.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.location}: {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="value-pair">
                  <label>
                    Baseline value
                    <input
                      value={fromValue}
                      onChange={(event) => setFromValue(event.target.value)}
                      placeholder="100"
                    />
                  </label>
                  <span>TO</span>
                  <label>
                    Changed value
                    <input
                      value={toValue}
                      onChange={(event) => setToValue(event.target.value)}
                      placeholder="200"
                    />
                  </label>
                </div>
              </ExperimentStep>
              <ExperimentStep
                n="04"
                title="CHOOSE RESULT + COMPARE"
                complete={Boolean(saved)}
              >
                <ObservationSelect
                  label="Result observation"
                  value={resultId}
                  observations={observations.filter(
                    (item) => item.id !== baselineId,
                  )}
                  onChange={setResultId}
                />
                <label>
                  Evidence note
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="What did you expect, and why?"
                  />
                </label>
                <button
                  className="compare-button"
                  disabled={!ready || saving}
                  onClick={() => void saveExperiment()}
                >
                  {saving ? "COMPARING..." : "COMPARE + SAVE EVIDENCE"}
                </button>
                {experimentError && <p className="error">{experimentError}</p>}
                {saved && (
                  <div className={`diff-result ${saved.status}`}>
                    <span>{saved.status.toUpperCase()}</span>
                    <strong>{saved.summary}</strong>
                    {saved.mutationDescription && (
                      <code>Changed only: {saved.mutationDescription}</code>
                    )}
                    <small>
                      {saved.evidenceCount} hash-linked evidence records saved
                    </small>
                  </div>
                )}
              </ExperimentStep>
            </div>
            {recommendations[0] && (
              <button
                className="lesson-link"
                onClick={() => onLesson(recommendations[0]!.lesson)}
              >
                LEARN: {recommendations[0].lesson.title} <span>-&gt;</span>
              </button>
            )}
          </>
        ) : (
          <Empty text="Import a HAR and select an endpoint node." />
        )}
      </section>
    </main>
  );
}

function HttpInspector({
  observation,
  observations,
  selectedId,
  onSelect,
  tab,
  onTab,
  diff,
  identities,
  onAssign,
}: {
  observation?: Observation;
  observations: Observation[];
  selectedId: string;
  onSelect: (id: string) => void;
  tab: "request" | "response" | "parsed" | "diff";
  onTab: (tab: "request" | "response" | "parsed" | "diff") => void;
  diff?: DiffView;
  identities: Identity[];
  onAssign: (observationId: string, identityId: string) => Promise<void>;
}) {
  const tabs = ["request", "response", "parsed", "diff"] as const;
  return (
    <section className="http-inspector">
      <div className="inspector-heading">
        <div>
          <span>IMPORTED TRANSACTION</span>
          <h2>HTTP inspector</h2>
        </div>
        <ObservationSelect
          label="Observation"
          value={selectedId || observation?.id || ""}
          observations={observations}
          onChange={onSelect}
        />
        <label className="identity-selector">
          Observed as
          <select
            aria-label="Observed as"
            value={observation?.identityId ?? ""}
            disabled={!observation}
            onChange={(event) =>
              observation && void onAssign(observation.id, event.target.value)
            }
          >
            <option value="" disabled>
              Unassigned
            </option>
            {identities.map((identity) => (
              <option key={identity.id} value={identity.id}>
                {identity.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="identity-context">
        <strong>
          {observation
            ? `${observation.method} ${observation.http?.request.target ?? observation.url}`
            : "No observation selected"}
        </strong>
        <span>
          Observed as: {identityLabel(observation?.identityId, identities)}
        </span>
        <span>Status: {observation?.responseStatus ?? "-"}</span>
      </div>
      <div
        className="inspector-tabs"
        role="tablist"
        aria-label="HTTP inspector"
      >
        {tabs.map((item) => (
          <button
            role="tab"
            aria-selected={tab === item}
            className={tab === item ? "active" : ""}
            key={item}
            onClick={() => onTab(item)}
          >
            {item.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="inspector-content">
        {!observation?.http ? (
          <p className="empty">
            This observation predates safe HTTP reconstruction.
          </p>
        ) : tab === "request" ? (
          <pre>{formatRequest(observation)}</pre>
        ) : tab === "response" ? (
          <pre>{formatResponse(observation)}</pre>
        ) : tab === "parsed" ? (
          <ParsedObservation observation={observation} />
        ) : diff ? (
          <DeepDiffView diff={diff} />
        ) : (
          <div className="inspector-diff">
            <strong>No comparison recorded for this investigation.</strong>
            <p>
              Choose two imported observations below to create a deterministic
              diff.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

const AUTHORIZATION_QUESTIONS = [
  "Does Account B receive data belonging to Account A?",
  "Does changing identity alter access to the same object?",
  "Can a lower-privileged identity access this endpoint?",
  "Does the server enforce both authentication and object ownership?",
  "Does the same resource behave differently for Anonymous vs authenticated identities?",
];

function IdentityComparison({
  endpoint,
  observations,
  identities,
  hypothesisId,
  onSaved,
}: {
  endpoint: Endpoint;
  observations: Observation[];
  identities: Identity[];
  hypothesisId?: string;
  onSaved: () => Promise<unknown>;
}) {
  const assigned = observations.filter((item) => item.identityId);
  const [baselineId, setBaselineId] = useState("");
  const [comparisonId, setComparisonId] = useState("");
  const [result, setResult] = useState<{
    diff: DiffView;
    controlled: boolean;
  } | null>(null);
  const baseline = observations.find((item) => item.id === baselineId);
  const comparison = observations.find((item) => item.id === comparisonId);
  const baselineIdentity = identities.find(
    (item) => item.id === baseline?.identityId,
  );
  const comparisonIdentity = identities.find(
    (item) => item.id === comparison?.identityId,
  );
  const controlled =
    baseline && comparison ? requestsMatch(baseline, comparison) : false;

  async function compare(): Promise<void> {
    if (
      !baseline ||
      !comparison ||
      !baselineIdentity ||
      !comparisonIdentity ||
      !hypothesisId
    )
      return;
    const response = await fetch("/api/experiments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpointId: endpoint.id,
        hypothesisId,
        baselineObservationId: baseline.id,
        resultObservationId: comparison.id,
        mutation: {
          identity: {
            fromRole: baselineIdentity.role,
            toRole: comparisonIdentity.role,
          },
        },
        notes: "Manual cross-identity comparison of imported observations",
      }),
    });
    const data = (await response.json()) as {
      error?: string;
      diff?: DiffView;
    };
    if (!response.ok || !data.diff)
      throw new Error(data.error ?? "Identity comparison failed");
    setResult({ diff: data.diff, controlled });
    await onSaved();
  }

  return (
    <section className="identity-comparison">
      <span className="eyebrow">AUTHORIZATION EXPERIMENT</span>
      <h2>Compare captured identities.</h2>
      <p>
        Imported observations only. SurfaceTrace asks questions; it does not
        make a vulnerability verdict.
      </p>
      <div className="identity-pair">
        <ObservationSelect
          label="Identity baseline observation"
          value={baselineId}
          observations={assigned}
          onChange={setBaselineId}
        />
        <ObservationSelect
          label="Identity comparison observation"
          value={comparisonId}
          observations={assigned.filter((item) => item.id !== baselineId)}
          onChange={setComparisonId}
        />
      </div>
      {baseline && (
        <p>
          <b>Baseline identity:</b>{" "}
          {identityLabel(baseline.identityId, identities)}
        </p>
      )}
      {comparison && (
        <p>
          <b>Comparison identity:</b>{" "}
          {identityLabel(comparison.identityId, identities)}
        </p>
      )}
      {baselineIdentity && comparisonIdentity && (
        <div className="identity-change">
          <span>Identity changed</span>
          <strong>
            {baselineIdentity.label} -&gt; {comparisonIdentity.label}
          </strong>
          <small>
            {controlled
              ? "CONTROLLED IDENTITY COMPARISON / request difference: identity only"
              : "OBSERVATIONAL COMPARISON / multiple differences detected"}
          </small>
        </div>
      )}
      <button
        className="compare-button"
        disabled={
          !baselineIdentity ||
          !comparisonIdentity ||
          baselineId === comparisonId ||
          baselineIdentity?.id === comparisonIdentity?.id ||
          !hypothesisId
        }
        onClick={() => void compare()}
      >
        COMPARE IDENTITIES + SAVE EVIDENCE
      </button>
      {result && (
        <div className="identity-diff">
          <h3>DETERMINISTIC RESPONSE DIFF</h3>
          <DeepDiffView diff={result.diff} />
          <dl>
            <dt>Status</dt>
            <dd>
              {baseline?.responseStatus === comparison?.responseStatus
                ? "same"
                : "different"}
            </dd>
            <dt>Headers</dt>
            <dd>
              {sameRecord(
                baseline?.http?.response.headers,
                comparison?.http?.response.headers,
              )
                ? "same"
                : "different"}
            </dd>
            <dt>Body shape / fields</dt>
            <dd>
              {baseline?.responseBodyShape === comparison?.responseBodyShape
                ? "same"
                : "different"}
            </dd>
          </dl>
        </div>
      )}
      <div className="authorization-questions">
        <h3>AUTHORIZATION REVIEW QUESTIONS</h3>
        {AUTHORIZATION_QUESTIONS.map((question) => (
          <p key={question}>{question}</p>
        ))}
      </div>
    </section>
  );
}

const EXPERIMENT_STATUS_OPTIONS = [
  "open",
  "investigating",
  "same",
  "different",
  "needs_review",
  "candidate_finding",
  "closed",
];
const CONCLUSION_OPTIONS = [
  ["no_meaningful_difference", "No meaningful difference"],
  ["expected_difference", "Expected difference"],
  ["unexpected_difference", "Unexpected difference"],
  ["needs_more_testing", "Needs more testing"],
  ["potential_security_issue", "Potential security issue"],
  ["not_reproducible", "Not reproducible"],
] as const;

function ExperimentNotebook({
  experiments,
  endpoints,
  hypotheses,
  observations,
  identities,
  onSaved,
}: {
  experiments: ExperimentRecord[];
  endpoints: Endpoint[];
  hypotheses: Hypothesis[];
  observations: Observation[];
  identities: Identity[];
  onSaved: () => Promise<unknown>;
}) {
  const [statusFilter, setStatusFilter] = useState("");
  const [endpointFilter, setEndpointFilter] = useState("");
  const [identityFilter, setIdentityFilter] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [notes, setNotes] = useState(() => experiments[0]?.notes ?? "");
  const filtered = experiments.filter(
    (item) =>
      (!statusFilter || item.status === statusFilter) &&
      (!endpointFilter || item.endpointId === endpointFilter) &&
      (!identityFilter ||
        item.baselineIdentityId === identityFilter ||
        item.resultIdentityId === identityFilter),
  );
  const selected =
    experiments.find((item) => item.id === selectedId) ?? filtered[0];

  async function update(changes: Record<string, unknown>): Promise<void> {
    if (!selected) return;
    const response = await fetch(`/api/experiments/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    });
    if (!response.ok) throw new Error("Experiment update failed");
    await onSaved();
  }

  return (
    <section className="experiment-notebook">
      <div className="notebook-title">
        <span className="eyebrow">EXPERIMENT NOTEBOOK</span>
        <h2>Review the investigation record.</h2>
      </div>
      <div className="experiment-filters">
        <label>
          Status
          <select
            aria-label="Filter experiments by status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">All statuses</option>
            {EXPERIMENT_STATUS_OPTIONS.map((status) => (
              <option value={status} key={status}>
                {displayValue(status)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Endpoint
          <select
            aria-label="Filter experiments by endpoint"
            value={endpointFilter}
            onChange={(event) => setEndpointFilter(event.target.value)}
          >
            <option value="">All endpoints</option>
            {endpoints.map((endpoint) => (
              <option value={endpoint.id} key={endpoint.id}>
                {endpoint.method} {endpoint.pathTemplate}
              </option>
            ))}
          </select>
        </label>
        <label>
          Identity
          <select
            aria-label="Filter experiments by identity"
            value={identityFilter}
            onChange={(event) => setIdentityFilter(event.target.value)}
          >
            <option value="">All identities</option>
            {identities.map((identity) => (
              <option value={identity.id} key={identity.id}>
                {identity.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="notebook-layout">
        <div className="experiment-list">
          {filtered.map((item) => (
            <button
              className={selected?.id === item.id ? "selected" : ""}
              key={item.id}
              onClick={() => {
                setSelectedId(item.id);
                setNotes(item.notes ?? "");
              }}
            >
              <strong>{endpointLabel(item.endpointId, endpoints)}</strong>
              <span>{item.mutationDescription}</span>
              <small>
                {displayValue(item.status)} / {item.diff.summary}
              </small>
              <small>
                {item.conclusion
                  ? displayValue(item.conclusion)
                  : "No tester conclusion"}{" "}
                / {item.createdAt}
              </small>
            </button>
          ))}
          {!filtered.length && <p>No experiments match these filters.</p>}
        </div>
        {selected && (
          <ExperimentDetail
            experiment={selected}
            endpoints={endpoints}
            hypotheses={hypotheses}
            observations={observations}
            identities={identities}
            notes={notes}
            onNotes={setNotes}
            onUpdate={update}
          />
        )}
      </div>
    </section>
  );
}

function ExperimentDetail({
  experiment,
  endpoints,
  hypotheses,
  observations,
  identities,
  notes,
  onNotes,
  onUpdate,
}: {
  experiment: ExperimentRecord;
  endpoints: Endpoint[];
  hypotheses: Hypothesis[];
  observations: Observation[];
  identities: Identity[];
  notes: string;
  onNotes: (value: string) => void;
  onUpdate: (changes: Record<string, unknown>) => Promise<void>;
}) {
  const baseline = observations.find(
    (item) => item.id === experiment.baselineObservationId,
  );
  const result = observations.find(
    (item) => item.id === experiment.resultObservationId,
  );
  const hypothesis = hypotheses.find(
    (item) => item.id === experiment.hypothesisId,
  );
  return (
    <article className="experiment-detail">
      <header>
        <span>{endpointLabel(experiment.endpointId, endpoints)}</span>
        <strong>{displayValue(experiment.status)}</strong>
      </header>
      {experiment.status === "candidate_finding" && (
        <p className="candidate-boundary">
          Candidate finding - requires reproduction and tester validation.
        </p>
      )}
      <h3>HYPOTHESIS</h3>
      <p>{hypothesis?.question ?? "Referenced hypothesis unavailable"}</p>
      <h3>IDENTITY CONTEXT</h3>
      <p>
        {identityLabel(experiment.baselineIdentityId, identities)} -&gt;{" "}
        {identityLabel(experiment.resultIdentityId, identities)}
      </p>
      <h3>BASELINE REQUEST</h3>
      <pre>
        {baseline?.http ? formatRequest(baseline) : "Observation unavailable"}
      </pre>
      <h3>CHANGED VARIABLE</h3>
      <div className="changed-only">
        <b>
          {experiment.comparisonClassification === "controlled"
            ? "Changed only:"
            : "Controlled experiment: NO"}
        </b>
        <code>{experiment.mutationDescription}</code>
        {experiment.requestDifferences.length > 0 && (
          <>
            <span>Multiple request differences detected:</span>
            <ul>
              {experiment.requestDifferences.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      <h3>COMPARISON REQUEST</h3>
      <pre>
        {result?.http ? formatRequest(result) : "Observation unavailable"}
      </pre>
      <h3>DIFF</h3>
      <DeepDiffView diff={experiment.diff} />
      <h3>TESTER CONCLUSION</h3>
      <select
        aria-label="Tester conclusion"
        value={experiment.conclusion ?? ""}
        onChange={(event) =>
          void onUpdate({ conclusion: event.target.value || null })
        }
      >
        <option value="">No conclusion selected</option>
        {CONCLUSION_OPTIONS.map(([value, label]) => (
          <option value={value} key={value}>
            {label}
          </option>
        ))}
      </select>
      <h3>NOTES</h3>
      <textarea
        aria-label="Experiment notes"
        value={notes}
        onChange={(event) => onNotes(event.target.value)}
      />
      <button onClick={() => void onUpdate({ notes })}>SAVE NOTES</button>
      <h3>STATUS</h3>
      <select
        aria-label="Experiment status"
        value={experiment.status}
        onChange={(event) => void onUpdate({ status: event.target.value })}
      >
        {EXPERIMENT_STATUS_OPTIONS.map((status) => (
          <option value={status} key={status}>
            {displayValue(status)}
          </option>
        ))}
      </select>
      <h3>EVIDENCE</h3>
      <ul>
        {experiment.evidenceIds.map((id) => (
          <li key={id}>
            <code>{id}</code>
          </li>
        ))}
      </ul>
    </article>
  );
}

function DeepDiffView({ diff }: { diff: DiffView }) {
  const changes = diff.bodyChanges ?? [];
  return (
    <section className="deep-diff">
      <div className="deep-diff-summary">
        <strong>SUMMARY</strong>
        <p>{diff.summary}</p>
        {diff.truncated && <span>Truncated: {diff.truncationReason}</span>}
      </div>
      <div className="diff-facts">
        <div>
          <b>STATUS</b>
          <span>
            {diff.statusChanged
              ? `${diff.statusFrom} -&gt; ${diff.statusTo}`
              : "same"}
          </span>
        </div>
        <div>
          <b>HEADERS</b>
          <span>
            {diff.headerChanges?.length
              ? diff.headerChanges.join(", ")
              : "same"}
          </span>
        </div>
        <div>
          <b>BODY SHAPE</b>
          <span>
            {diff.bodyComparison ?? (changes.length ? "different" : "same")}
          </span>
        </div>
        <div>
          <b>FIELDS CHANGED</b>
          <span>{diff.bodyChangeCount ?? changes.length}</span>
        </div>
      </div>
      <div className="field-changes">
        {changes.map((change, index) => (
          <details open key={`${change.path}:${change.changeType}:${index}`}>
            <summary>
              <code>{change.path}</code>
              <span>{displayValue(change.changeType)}</span>
            </summary>
            <dl>
              <dt>Before</dt>
              <dd>
                <code>{displayDiffValue(change.before)}</code>
              </dd>
              <dt>After</dt>
              <dd>
                <code>{displayDiffValue(change.after)}</code>
              </dd>
            </dl>
          </details>
        ))}
        {!changes.length && <p>No nested JSON field changes recorded.</p>}
      </div>
    </section>
  );
}

function displayDiffValue(value: unknown): string {
  return value === undefined
    ? "(absent)"
    : (JSON.stringify(value) ?? String(value));
}

function endpointLabel(endpointId: string, endpoints: Endpoint[]): string {
  const endpoint = endpoints.find((item) => item.id === endpointId);
  return endpoint ? `${endpoint.method} ${endpoint.pathTemplate}` : endpointId;
}
function displayValue(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function identityLabel(
  identityId: string | null | undefined,
  identities: Identity[],
): string {
  return (
    identities.find((item) => item.id === identityId)?.label ?? "Unassigned"
  );
}
function sameRecord(
  left?: Record<string, string>,
  right?: Record<string, string>,
): boolean {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}
function requestsMatch(left: Observation, right: Observation): boolean {
  if (
    !left.http ||
    !right.http ||
    left.method !== right.method ||
    left.http.request.target !== right.http.request.target ||
    left.http.request.body !== right.http.request.body
  )
    return false;
  const ordinary = (headers: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(headers).filter(
        ([name]) => !["authorization", "cookie"].includes(name.toLowerCase()),
      ),
    );
  return sameRecord(
    ordinary(left.http.request.headers),
    ordinary(right.http.request.headers),
  );
}

function formatRequest(observation: Observation): string {
  const request = observation.http!.request;
  const lines = [
    `${observation.method} ${request.target} ${request.httpVersion}`,
    ...Object.entries(request.headers).map(
      ([name, value]) => `${name}: ${value}`,
    ),
  ];
  if (request.body !== null) lines.push("", request.body);
  return lines.join("\n");
}

function formatResponse(observation: Observation): string {
  const response = observation.http!.response;
  const lines = [
    `${response.httpVersion} ${response.status} ${response.statusText}`,
    ...Object.entries(response.headers).map(
      ([name, value]) => `${name}: ${value}`,
    ),
  ];
  if (response.body !== null) lines.push("", response.body);
  return lines.join("\n");
}

function ParsedObservation({ observation }: { observation: Observation }) {
  return (
    <div className="parsed-http">
      <dl>
        <dt>Method</dt>
        <dd>{observation.method}</dd>
        <dt>Path</dt>
        <dd>
          <code>{observation.http!.request.target}</code>
        </dd>
      </dl>
      <h3>INPUTS</h3>
      {observation.parsedInputs?.length ? (
        <ul>
          {observation.parsedInputs.map((input) => (
            <li key={`${input.location}:${input.name}`}>
              <code>{parsedInputName(input.location, input.name)}</code>
              <span>
                {input.type}
                {input.sensitive ? " / redacted" : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>No inputs parsed from this observation.</p>
      )}
    </div>
  );
}

function parsedInputName(location: string, name: string): string {
  const prefix =
    location === "body-json" || location === "body-form" ? "body" : location;
  return `${prefix}.${name}`;
}

function ExperimentStep({
  n,
  title,
  complete,
  children,
}: {
  n: string;
  title: string;
  complete: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`experiment-step ${complete ? "complete" : ""}`}>
      <header>
        <span>{n}</span>
        <strong>{title}</strong>
        <i>{complete ? "READY" : "PENDING"}</i>
      </header>
      <div>{children}</div>
    </section>
  );
}
function ObservationSelect({
  label,
  value,
  observations,
  onChange,
}: {
  label: string;
  value: string;
  observations: Observation[];
  onChange: (id: string) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select an imported observation</option>
        {observations.map((item) => (
          <option key={item.id} value={item.id}>
            {item.url} / {item.responseStatus} / {item.responseSize} bytes
          </option>
        ))}
      </select>
    </label>
  );
}

function Classroom({
  selected,
  skills,
  onOpen,
  onSkill,
  onReturn,
  recommendation,
}: {
  selected?: Lesson;
  skills: Record<string, SkillState>;
  onOpen: (lesson: Lesson) => void;
  onSkill: (id: string, state: SkillState) => void;
  onReturn: () => void;
  recommendation?: ReturnType<typeof recommendLessons>[number];
}) {
  if (selected)
    return (
      <main className="lesson-page reveal">
        <button className="back" onClick={onReturn}>
          &lt;- RETURN TO INVESTIGATION
        </button>
        <span className="eyebrow">
          {selected.track} / {selected.estimatedMinutes} MIN
        </span>
        <h1>{selected.title}</h1>
        {selected.content ? (
          <div className="lesson-steps">
            <LessonStep
              n="01"
              title="CONCEPT"
              text={selected.content.concept}
            />
            <LessonStep
              n="02"
              title="SIMPLE EXAMPLE"
              text={selected.content.example}
              code
            />
            <LessonStep
              n="03"
              title="BUG-HUNTER CONNECTION"
              text={selected.content.connection}
            />
            <LessonStep
              n="04"
              title="READ THIS"
              text={selected.content.inspect}
              code
            />
            <LessonStep
              n="05"
              title="TRY IT YOURSELF"
              text={selected.exercise ?? "Inspect an example."}
            />
            <LessonStep
              n="06"
              title="QUICK CHECK"
              text={selected.quickCheck ?? "Explain the concept."}
            />
            <LessonStep
              n="07"
              title="APPLY IN SURFACETRACE"
              text={selected.content.apply}
            />
          </div>
        ) : (
          <p className="coming">
            This lesson is mapped; full prose is planned for a later content
            pass.
          </p>
        )}
        <div className="skill-actions">
          <button onClick={() => onSkill(selected.id, "Comfortable")}>
            I UNDERSTAND THIS
          </button>
          <button onClick={() => onSkill(selected.id, "Learning")}>
            I NEED MORE PRACTICE
          </button>
          <span>{skills[selected.id] ?? "Not Started"}</span>
        </div>
      </main>
    );
  return (
    <main className="classroom-home reveal">
      <div className="classroom-hero">
        <span className="eyebrow">CLASSROOM / LOCAL PROGRESS</span>
        <h1>Learn what the traffic is telling you.</h1>
        <p>
          Short lessons bridge code, HTTP, application behavior, and security
          reasoning.
        </p>
        {recommendation && (
          <button
            className="action coral"
            onClick={() => onOpen(recommendation.lesson)}
          >
            RECOMMENDED: {recommendation.lesson.title} -&gt;
          </button>
        )}
      </div>
      {trackNames.map((track) => {
        const lessons = curriculum.filter((item) => item.track === track);
        const complete = lessons.filter(
          (item) => skills[item.id] === "Comfortable",
        ).length;
        return (
          <section className="track" key={track}>
            <div>
              <span>
                {String(trackNames.indexOf(track) + 1).padStart(2, "0")}
              </span>
              <h2>{track}</h2>
              <small>
                {complete} / {lessons.length} comfortable
              </small>
            </div>
            <div className="lesson-list">
              {lessons.map((item) => (
                <button key={item.id} onClick={() => onOpen(item)}>
                  <span>{item.title}</span>
                  <small>{skills[item.id] ?? "Not Started"}</small>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}

function EvidenceView({
  evidence,
  observations,
}: {
  evidence: Evidence[];
  observations: Observation[];
}) {
  return (
    <main className="evidence-page reveal">
      <span className="eyebrow">APPEND-ONLY / HASH-LINKED</span>
      <h1>Evidence ledger</h1>
      <p>
        Observations, hypotheses, experiments, diffs, and conclusions remain
        distinct.
      </p>
      <div className="ledger">
        {evidence.map((item, index) => (
          <article key={item.id}>
            <b>{String(index + 1).padStart(2, "0")}</b>
            <div>
              <strong>{item.kind.toUpperCase()}</strong>
              <code>{item.contentHash}</code>
              <small>{item.createdAt}</small>
            </div>
          </article>
        ))}
        {!evidence.length && (
          <Empty text="The first normalized import will create an evidence record." />
        )}
      </div>
      <h2>NORMALIZED OBSERVATIONS</h2>
      {observations.map((item) => (
        <div className="observation" key={item.id}>
          <b>{item.method}</b>
          <code>{item.url}</code>
          <span>{item.responseStatus}</span>
        </div>
      ))}
    </main>
  );
}
function PanelLabel({ number, label }: { number: string; label: string }) {
  return (
    <div className="panel-label">
      <span>{number}</span>
      <strong>{label}</strong>
    </div>
  );
}
function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="metric">
      <strong>{String(value).padStart(2, "0")}</strong>
      <span>{label}</span>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <p className="empty">{text}</p>;
}
function LessonStep({
  n,
  title,
  text,
  code = false,
}: {
  n: string;
  title: string;
  text: string;
  code?: boolean;
}) {
  return (
    <section>
      <div>
        <span>{n}</span>
        <b>{title}</b>
      </div>
      {code ? <pre>{text}</pre> : <p>{text}</p>}
    </section>
  );
}
