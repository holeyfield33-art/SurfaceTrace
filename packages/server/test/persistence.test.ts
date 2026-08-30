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
        "Unsupported SurfaceTrace database schema version 99; expected 1",
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
});
