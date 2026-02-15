import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";

export interface SearchResult {
  date: string;
  content: string;
  distance: number;
  type: string;
}

export class VectorDB {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    sqliteVec.load(this.db);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.createTables();
  }

  private createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        type        TEXT NOT NULL,
        date        TEXT NOT NULL,
        content     TEXT NOT NULL,
        embedded_at TEXT NOT NULL,
        model       TEXT NOT NULL
      );
    `);

    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_type_date
      ON documents(type, date);
    `);

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_documents USING vec0(
        embedding float[1024]
      );
    `);
  }

  upsert(
    type: string,
    date: string,
    content: string,
    embedding: Float32Array,
    model: string
  ): void {
    const tx = this.db.transaction(() => {
      // Check if document already exists
      const existing = this.db
        .query<{ id: number }, [string, string]>(
          "SELECT id FROM documents WHERE type = ? AND date = ?"
        )
        .get(type, date);

      if (existing) {
        // Update existing document
        this.db
          .query(
            "UPDATE documents SET content = ?, embedded_at = ?, model = ? WHERE id = ?"
          )
          .run(content, new Date().toISOString(), model, existing.id);

        // Delete old vector and insert new one
        this.db.query("DELETE FROM vec_documents WHERE rowid = ?").run(existing.id);
        this.db
          .query(
            "INSERT INTO vec_documents(rowid, embedding) VALUES (?, ?)"
          )
          .run(existing.id, new Uint8Array(embedding.buffer));
      } else {
        // Insert new document
        const result = this.db
          .query(
            "INSERT INTO documents (type, date, content, embedded_at, model) VALUES (?, ?, ?, ?, ?)"
          )
          .run(type, date, content, new Date().toISOString(), model);

        const id = Number(result.lastInsertRowid);
        this.db
          .query(
            "INSERT INTO vec_documents(rowid, embedding) VALUES (?, ?)"
          )
          .run(id, new Uint8Array(embedding.buffer));
      }
    });

    tx();
  }

  query(
    embedding: Float32Array,
    limit: number = 5,
    type?: string
  ): SearchResult[] {
    const embeddingBytes = new Uint8Array(embedding.buffer);

    if (type) {
      return this.db
        .query<
          { date: string; content: string; distance: number; type: string },
          [Uint8Array, string, number]
        >(
          `SELECT d.date, d.content, v.distance, d.type
           FROM vec_documents v
           JOIN documents d ON d.id = v.rowid
           WHERE v.embedding MATCH ?
           AND d.type = ?
           ORDER BY v.distance
           LIMIT ?`
        )
        .all(embeddingBytes, type, limit);
    }

    return this.db
      .query<
        { date: string; content: string; distance: number; type: string },
        [Uint8Array, number]
      >(
        `SELECT d.date, d.content, v.distance, d.type
         FROM vec_documents v
         JOIN documents d ON d.id = v.rowid
         WHERE v.embedding MATCH ?
         ORDER BY v.distance
         LIMIT ?`
      )
      .all(embeddingBytes, limit);
  }

  getEmbeddedDates(model: string): Set<string> {
    const rows = this.db
      .query<{ date: string }, [string, string]>(
        "SELECT date FROM documents WHERE type = ? AND model = ?"
      )
      .all("report", model);

    return new Set(rows.map((r) => r.date));
  }

  getStats(): { reports: number; notes: number } {
    const reportCount = this.db
      .query<{ count: number }, [string]>(
        "SELECT COUNT(*) as count FROM documents WHERE type = ?"
      )
      .get("report");

    const noteCount = this.db
      .query<{ count: number }, [string]>(
        "SELECT COUNT(*) as count FROM documents WHERE type = ?"
      )
      .get("note");

    return {
      reports: reportCount?.count ?? 0,
      notes: noteCount?.count ?? 0,
    };
  }

  getNotes(): { date: string; content: string }[] {
    return this.db
      .query<{ date: string; content: string }, []>(
        "SELECT date, content FROM documents WHERE type = 'note' ORDER BY date DESC"
      )
      .all();
  }

  deleteByType(type: string): number {
    const ids = this.db
      .query<{ id: number }, [string]>(
        "SELECT id FROM documents WHERE type = ?"
      )
      .all(type);

    if (ids.length === 0) return 0;

    const tx = this.db.transaction(() => {
      for (const { id } of ids) {
        this.db.query("DELETE FROM vec_documents WHERE rowid = ?").run(id);
      }
      this.db.query("DELETE FROM documents WHERE type = ?").run(type);
    });

    tx();
    return ids.length;
  }

  deleteByDate(type: string, date: string): boolean {
    const existing = this.db
      .query<{ id: number }, [string, string]>(
        "SELECT id FROM documents WHERE type = ? AND date = ?"
      )
      .get(type, date);

    if (!existing) return false;

    const tx = this.db.transaction(() => {
      this.db.query("DELETE FROM vec_documents WHERE rowid = ?").run(existing.id);
      this.db
        .query("DELETE FROM documents WHERE type = ? AND date = ?")
        .run(type, date);
    });

    tx();
    return true;
  }

  clearAll(): void {
    this.db.exec("DELETE FROM vec_documents");
    this.db.exec("DELETE FROM documents");
  }

  close(): void {
    this.db.close();
  }
}
