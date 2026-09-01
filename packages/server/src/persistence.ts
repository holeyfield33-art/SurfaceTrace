import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { hashPayload } from "@surfacetrace/core";
import type {
  Asset,
  Endpoint,
  EvidenceRecord,
  Experiment,
  Hypothesis,
  IdentityContext,
  InputDescriptor,
  Observation,
  ProjectScope,
  TrustBoundary,
} from "@surfacetrace/core";

const SCHEMA_VERSION = 3;

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImportRecord {
  id: string;
  projectId: string;
  createdAt: string;
  observationCount: number;
  skippedEntryCount: number;
  sourceLabel: string;
}

export interface PersistedState {
  project: ProjectRecord;
  activeImport: ImportRecord | null;
  observations: Observation[];
  endpoints: Endpoint[];
  inputs: InputDescriptor[];
  identities: IdentityContext[];
  assets: Asset[];
  trustBoundaries: TrustBoundary[];
  hypotheses: Hypothesis[];
  experiments: Experiment[];
  evidence: EvidenceRecord[];
  scope: ProjectScope | null;
}

const ENTITY_TABLES = [
  "identities",
  "identity_assignments",
  "assets",
  "trust_boundaries",
  "hypotheses",
  "hypothesis_links",
  "experiments",
  "experiment_evidence_links",
  "evidence_records",
  "project_scopes",
] as const;

export class SqlitePersistence {
  private readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new Database(path);
    try {
      this.db.pragma("foreign_keys = ON");
      this.initialize();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  schemaVersion(): number {
    return Number(
      (
        this.db.prepare("SELECT version FROM schema_version").get() as {
          version: number;
        }
      ).version,
    );
  }

  listProjects(): ProjectRecord[] {
    return this.db
      .prepare(
        "SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM projects ORDER BY updated_at DESC",
      )
      .all() as ProjectRecord[];
  }

  createProject(name = "Untitled Investigation"): ProjectRecord {
    const now = new Date().toISOString();
    const project = {
      id: crypto.randomUUID(),
      name,
      createdAt: now,
      updatedAt: now,
    };
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
        )
        .run(project.id, project.name, project.createdAt, project.updatedAt);
      this.db
        .prepare(
          "INSERT INTO project_integrity_policy (project_id, required, anchor_hash) VALUES (?, 0, NULL)",
        )
        .run(project.id);
    })();
    return project;
  }

  integrityPolicy(projectId: string): {
    required: boolean;
    anchorHash: string | null;
  } {
    const row = this.db
      .prepare(
        "SELECT required, anchor_hash AS anchorHash FROM project_integrity_policy WHERE project_id = ?",
      )
      .get(projectId) as
      | { required: number; anchorHash: string | null }
      | undefined;
    if (!row)
      throw new Error(
        `Missing investigation integrity policy for project ${projectId}`,
      );
    return {
      required: row.required === 1,
      anchorHash: row.anchorHash,
    };
  }

  listImports(projectId: string): ImportRecord[] {
    return this.db
      .prepare(
        `SELECT id, project_id AS projectId, created_at AS createdAt,
      observation_count AS observationCount, skipped_entry_count AS skippedEntryCount,
      source_label AS sourceLabel FROM imports WHERE project_id = ? ORDER BY created_at DESC`,
      )
      .all(projectId) as ImportRecord[];
  }

  load(projectId: string): PersistedState | null {
    const project = this.db
      .prepare(
        "SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM projects WHERE id = ?",
      )
      .get(projectId) as ProjectRecord | undefined;
    if (!project) return null;
    const activeImport = this.listImports(projectId)[0] ?? null;
    const readPayloads = <T>(
      table: string,
      where = "project_id = ?",
      value = projectId,
    ): T[] =>
      (
        this.db
          .prepare(
            `SELECT payload FROM ${table} WHERE ${where} ORDER BY row_order, id`,
          )
          .all(value) as Array<{ payload: string }>
      ).map((row) => JSON.parse(row.payload) as T);
    const observations = activeImport
      ? readPayloads<Observation>(
          "observations",
          "import_id = ?",
          activeImport.id,
        )
      : [];
    const endpoints = activeImport
      ? readPayloads<Endpoint>("endpoints", "import_id = ?", activeImport.id)
      : [];
    const inputs = activeImport
      ? readPayloads<InputDescriptor>(
          "inputs",
          "import_id = ?",
          activeImport.id,
        )
      : [];
    const identities = readPayloads<IdentityContext>("identities");
    const assignments = this.db
      .prepare(
        "SELECT identity_id AS identityId, observation_id AS observationId FROM identity_assignments WHERE project_id = ?",
      )
      .all(projectId) as Array<{ identityId: string; observationId: string }>;
    const identityByObservation = new Map(
      assignments.map((item) => [item.observationId, item.identityId]),
    );
    for (const observation of observations)
      observation.identityId =
        identityByObservation.get(observation.id) ?? null;
    return {
      project,
      activeImport,
      observations,
      endpoints,
      inputs,
      identities,
      assets: readPayloads<Asset>("assets"),
      trustBoundaries: readPayloads<TrustBoundary>("trust_boundaries"),
      hypotheses: readPayloads<Hypothesis>("hypotheses"),
      experiments: readPayloads<Experiment>("experiments"),
      evidence: readPayloads<EvidenceRecord>("evidence_records"),
      scope: readPayloads<ProjectScope>("project_scopes")[0] ?? null,
    };
  }

  investigationHash(state: PersistedState): string {
    const readImportPayloads = <T>(table: string, importId: string): T[] =>
      (
        this.db
          .prepare(
            `SELECT payload FROM ${table} WHERE import_id = ? ORDER BY row_order, id`,
          )
          .all(importId) as Array<{ payload: string }>
      ).map((row) => JSON.parse(row.payload) as T);
    const imports = this.listImports(state.project.id).map((record) => ({
      record,
      observations: readImportPayloads<Observation>("observations", record.id),
      endpoints: readImportPayloads<Endpoint>("endpoints", record.id),
      inputs: readImportPayloads<InputDescriptor>("inputs", record.id),
    }));
    if (state.activeImport) {
      const active = {
        record: state.activeImport,
        observations: state.observations,
        endpoints: state.endpoints,
        inputs: state.inputs,
      };
      const index = imports.findIndex(
        (item) => item.record.id === state.activeImport?.id,
      );
      if (index >= 0) imports[index] = active;
      else imports.push(active);
    }
    imports.sort(
      (left, right) =>
        right.record.createdAt.localeCompare(left.record.createdAt) ||
        left.record.id.localeCompare(right.record.id),
    );
    return hashPayload({
      project: state.project,
      imports,
      identities: state.identities,
      assets: state.assets,
      trustBoundaries: state.trustBoundaries,
      hypotheses: state.hypotheses,
      experiments: state.experiments,
      scope: state.scope,
    });
  }

  save(
    state: PersistedState,
    newImport = false,
    activeImportChanged = false,
    integrityAnchorHash?: string,
  ): void {
    this.db.transaction(() => {
      this.db
        .prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?")
        .run(state.project.name, state.project.updatedAt, state.project.id);
      if (newImport && state.activeImport) {
        const item = state.activeImport;
        this.db
          .prepare(
            `INSERT INTO imports
          (id, project_id, created_at, observation_count, skipped_entry_count, source_label)
          VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            item.id,
            item.projectId,
            item.createdAt,
            item.observationCount,
            item.skippedEntryCount,
            item.sourceLabel,
          );
      }
      if (state.activeImport && (newImport || activeImportChanged)) {
        for (const table of ["observations", "endpoints", "inputs"])
          this.db
            .prepare(`DELETE FROM ${table} WHERE import_id = ?`)
            .run(state.activeImport.id);
        this.writeImportEntities(
          "observations",
          state.activeImport.id,
          state.observations,
        );
        this.writeImportEntities(
          "endpoints",
          state.activeImport.id,
          state.endpoints,
        );
        this.writeImportEntities("inputs", state.activeImport.id, state.inputs);
      }
      for (const table of ENTITY_TABLES)
        this.db
          .prepare(`DELETE FROM ${table} WHERE project_id = ?`)
          .run(state.project.id);
      this.writeProjectEntities(
        "identities",
        state.project.id,
        state.identities,
      );
      this.writeProjectEntities("assets", state.project.id, state.assets);
      this.writeProjectEntities(
        "trust_boundaries",
        state.project.id,
        state.trustBoundaries,
      );
      this.writeProjectEntities(
        "hypotheses",
        state.project.id,
        state.hypotheses,
      );
      this.writeProjectEntities(
        "experiments",
        state.project.id,
        state.experiments,
      );
      this.writeProjectEntities(
        "evidence_records",
        state.project.id,
        state.evidence,
      );
      this.writeProjectEntities(
        "project_scopes",
        state.project.id,
        state.scope ? [state.scope] : [],
      );
      for (const [order, identity] of state.identities.entries())
        for (const observationId of identity.associatedObservationIds)
          this.db
            .prepare(
              "INSERT INTO identity_assignments (id, project_id, identity_id, observation_id, row_order, payload) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .run(
              `${identity.id}:${observationId}`,
              state.project.id,
              identity.id,
              observationId,
              order,
              "{}",
            );
      for (const [order, hypothesis] of state.hypotheses.entries()) {
        const links = [
          ...hypothesis.observationIds.map((id) => ["observation", id]),
          ...hypothesis.experimentIds.map((id) => ["experiment", id]),
          ...hypothesis.assetIds.map((id) => ["asset", id]),
          ...hypothesis.trustBoundaryIds.map((id) => ["trust_boundary", id]),
          ...hypothesis.evidenceIds.map((id) => ["evidence", id]),
        ];
        for (const [kind, targetId] of links)
          this.db
            .prepare(
              "INSERT INTO hypothesis_links (id, project_id, hypothesis_id, link_kind, target_id, row_order, payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
              `${hypothesis.id}:${kind}:${targetId}`,
              state.project.id,
              hypothesis.id,
              kind,
              targetId,
              order,
              "{}",
            );
      }
      for (const [order, experiment] of state.experiments.entries())
        for (const evidenceId of experiment.evidenceIds)
          this.db
            .prepare(
              "INSERT INTO experiment_evidence_links (id, project_id, experiment_id, evidence_id, row_order, payload) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .run(
              `${experiment.id}:${evidenceId}`,
              state.project.id,
              experiment.id,
              evidenceId,
              order,
              "{}",
            );
      if (integrityAnchorHash !== undefined) {
        const updated = this.db
          .prepare(
            "UPDATE project_integrity_policy SET required = 1, anchor_hash = ? WHERE project_id = ?",
          )
          .run(integrityAnchorHash, state.project.id);
        if (updated.changes !== 1)
          throw new Error("Investigation integrity policy update failed");
      }
    })();
  }

  private writeImportEntities(
    table: string,
    importId: string,
    values: Array<{ id: string }>,
  ): void {
    const statement = this.db.prepare(
      `INSERT INTO ${table} (id, import_id, row_order, payload) VALUES (?, ?, ?, ?)`,
    );
    values.forEach((value, order) =>
      statement.run(value.id, importId, order, JSON.stringify(value)),
    );
  }

  private writeProjectEntities(
    table: string,
    projectId: string,
    values: Array<{ id: string }>,
  ): void {
    const statement = this.db.prepare(
      `INSERT INTO ${table} (id, project_id, row_order, payload) VALUES (?, ?, ?, ?)`,
    );
    values.forEach((value, order) =>
      statement.run(value.id, projectId, order, JSON.stringify(value)),
    );
  }

  private initialize(): void {
    const hasVersion = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'",
      )
      .get();
    if (hasVersion) {
      let version = this.schemaVersion();
      if (version === 1) {
        this.db.exec(`
          BEGIN;
          CREATE TABLE project_scopes (id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id), row_order INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (id, project_id));
          UPDATE schema_version SET version = 2;
          COMMIT;
        `);
        version = 2;
      }
      if (version === 2) {
        this.db.exec(`
          BEGIN;
          CREATE TABLE project_integrity_policy (project_id TEXT PRIMARY KEY REFERENCES projects(id), required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)), anchor_hash TEXT);
          INSERT INTO project_integrity_policy (project_id, required, anchor_hash) SELECT id, 0, NULL FROM projects;
          UPDATE schema_version SET version = 3;
          COMMIT;
        `);
        version = 3;
      }
      if (version !== SCHEMA_VERSION)
        throw new Error(
          `Unsupported SurfaceTrace database schema version ${version}; expected ${SCHEMA_VERSION}`,
        );
      return;
    }
    this.db.exec(`
      BEGIN;
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version VALUES (${SCHEMA_VERSION});
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE project_integrity_policy (project_id TEXT PRIMARY KEY REFERENCES projects(id), required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)), anchor_hash TEXT);
      CREATE TABLE imports (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), created_at TEXT NOT NULL, observation_count INTEGER NOT NULL, skipped_entry_count INTEGER NOT NULL, source_label TEXT NOT NULL);
      CREATE TABLE observations (id TEXT NOT NULL, import_id TEXT NOT NULL REFERENCES imports(id), row_order INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (id, import_id));
      CREATE TABLE endpoints (id TEXT NOT NULL, import_id TEXT NOT NULL REFERENCES imports(id), row_order INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (id, import_id));
      CREATE TABLE inputs (id TEXT NOT NULL, import_id TEXT NOT NULL REFERENCES imports(id), row_order INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (id, import_id));
      ${ENTITY_TABLES.map((table) => `CREATE TABLE ${table} (id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id), row_order INTEGER NOT NULL, payload TEXT NOT NULL${table === "identity_assignments" ? ", identity_id TEXT NOT NULL, observation_id TEXT NOT NULL" : ""}${table === "hypothesis_links" ? ", hypothesis_id TEXT NOT NULL, link_kind TEXT NOT NULL, target_id TEXT NOT NULL" : ""}${table === "experiment_evidence_links" ? ", experiment_id TEXT NOT NULL, evidence_id TEXT NOT NULL" : ""}, PRIMARY KEY (id, project_id));`).join("\n")}
      COMMIT;
    `);
  }
}
