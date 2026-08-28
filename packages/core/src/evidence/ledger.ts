import type { EvidenceRecord } from "../types.js";
import { hashPayload } from "./hash.js";

export class EvidenceLedger {
  private records: EvidenceRecord[] = [];
  private lastHash: string | null = null;

  append(
    kind: EvidenceRecord["kind"],
    payload: unknown
  ): EvidenceRecord {
    const createdAt = new Date().toISOString();
    const contentHash = hashPayload({ kind, payload, prev: this.lastHash, createdAt });
    const record: EvidenceRecord = {
      id: contentHash.slice(0, 24),
      prevHash: this.lastHash,
      contentHash,
      kind,
      payload,
      createdAt,
    };
    this.records.push(record);
    this.lastHash = contentHash;
    return record;
  }

  all(): readonly EvidenceRecord[] {
    return this.records;
  }

  /**
   * Verify the chain from head to tail.
   * Returns true if every link is intact.
   */
  verify(): boolean {
    let expectedPrev: string | null = null;
    for (const r of this.records) {
      if (r.prevHash !== expectedPrev) return false;
      const recomputed = hashPayload({
        kind: r.kind,
        payload: r.payload,
        prev: r.prevHash,
        createdAt: r.createdAt,
      });
      if (recomputed !== r.contentHash) return false;
      expectedPrev = r.contentHash;
    }
    return true;
  }

  tipHash(): string | null {
    return this.lastHash;
  }
}
