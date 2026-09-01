import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqlitePersistence, type PersistedState } from "../src/persistence.js";

describe("SQLite persistence adapter", () => {
  test("rolls back a multi-table snapshot when one entity write fails", () => {
    const persistence = new SqlitePersistence(":memory:");
    const project = persistence.createProject("Rollback test");
    const state: PersistedState = {
      project,
      activeImport: null,
      observations: [],
      endpoints: [],
      inputs: [],
      identities: [
        {
          id: "account-a",
          label: "Account A",
          role: "user",
          notes: null,
          associatedObservationIds: [],
        },
      ],
      assets: [],
      trustBoundaries: [],
      hypotheses: [],
      experiments: [],
      evidence: [],
      scope: null,
    };
    persistence.save(state);
    expect(() =>
      persistence.save({
        ...state,
        identities: [state.identities[0]!, state.identities[0]!],
      }),
    ).toThrow();
    expect(persistence.load(project.id)?.identities).toEqual(state.identities);
    persistence.close();
  });

  test("selects the last inserted import when timestamps are identical", () => {
    const persistence = new SqlitePersistence(":memory:");
    const project = persistence.createProject("Import ordering test");
    const state: PersistedState = {
      project,
      activeImport: null,
      observations: [],
      endpoints: [],
      inputs: [],
      identities: [],
      assets: [],
      trustBoundaries: [],
      hypotheses: [],
      experiments: [],
      evidence: [],
      scope: null,
    };
    const createdAt = "2026-08-31T12:00:00.000Z";
    for (const id of ["first-import", "second-import"]) {
      state.activeImport = {
        id,
        projectId: project.id,
        createdAt,
        observationCount: 0,
        skippedEntryCount: 0,
        sourceLabel: id,
      };
      persistence.save(state, true);
    }
    expect(persistence.listImports(project.id).map((item) => item.id)).toEqual([
      "second-import",
      "first-import",
    ]);
    expect(persistence.load(project.id)?.activeImport?.id).toBe("second-import");
    persistence.close();
  });

  test("rejects an unsupported schema without recreating the database", () => {
    const directory = mkdtempSync(join(tmpdir(), "surfacetrace-version-"));
    const dbPath = join(directory, "future.db");
    try {
      const database = new Database(dbPath);
      database.exec(
        "CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (99);",
      );
      database.close();
      expect(() => new SqlitePersistence(dbPath)).toThrow(
        "Unsupported SurfaceTrace database schema version 99; expected 3",
      );
      const reopened = new Database(dbPath, { readonly: true });
      expect(
        (
          reopened.prepare("SELECT version FROM schema_version").get() as {
            version: number;
          }
        ).version,
      ).toBe(99);
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("migrates a version 1 database without deleting projects", () => {
    const directory = mkdtempSync(join(tmpdir(), "surfacetrace-migrate-"));
    const dbPath = join(directory, "v1.db");
    try {
      const database = new Database(dbPath);
      database.exec(`
        CREATE TABLE schema_version (version INTEGER NOT NULL);
        INSERT INTO schema_version VALUES (1);
        CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        INSERT INTO projects VALUES ('project-v1', 'Existing project', 'now', 'now');
      `);
      database.close();
      const persistence = new SqlitePersistence(dbPath);
      expect(persistence.schemaVersion()).toBe(3);
      expect(persistence.listProjects()).toEqual([
        expect.objectContaining({ id: "project-v1", name: "Existing project" }),
      ]);
      expect(persistence.integrityPolicy("project-v1")).toEqual({
        required: false,
        anchorHash: null,
      });
      persistence.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
