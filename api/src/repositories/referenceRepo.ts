import type { Queryable } from '../db';
import type { RecordStatus, RefEntry } from '../types';

export type RefKind = 'department' | 'specialization';

interface Row {
  id: number;
  name: string;
  status: RecordStatus;
  doctor_count: string;
}

const toEntry = (r: Row): RefEntry => ({ id: r.id, name: r.name, status: r.status, doctorCount: Number(r.doctor_count) });

/** Departments and specializations share one shape; `kind` is a fixed table name, never user input. */
export class ReferenceRepo {
  constructor(
    private readonly db: Queryable,
    private readonly kind: RefKind,
  ) {}

  private select(where: string): string {
    return `SELECT r.id, r.name, r.status,
              (SELECT count(*) FROM doctor d WHERE d.${this.kind}_id = r.id) AS doctor_count
            FROM ${this.kind} r ${where}`;
  }

  async list(): Promise<RefEntry[]> {
    return (await this.db.query<Row>(`${this.select('')} ORDER BY lower(r.name)`)).rows.map(toEntry);
  }

  async get(id: number): Promise<RefEntry | null> {
    const row = (await this.db.query<Row>(this.select('WHERE r.id = $1'), [id])).rows[0];
    return row ? toEntry(row) : null;
  }

  async create(name: string, actor: string): Promise<number> {
    const { rows } = await this.db.query<{ id: number }>(
      `INSERT INTO ${this.kind} (name, created_by, updated_by) VALUES ($1, $2, $2) RETURNING id`,
      [name, actor],
    );
    return rows[0]!.id;
  }

  async update(id: number, patch: { name?: string; status?: RecordStatus }, actor: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE ${this.kind} SET name = COALESCE($2, name), status = COALESCE($3, status),
              updated_at = now(), updated_by = $4
        WHERE id = $1`,
      [id, patch.name ?? null, patch.status ?? null, actor],
    );
    return (rowCount ?? 0) > 0;
  }

  async delete(id: number): Promise<boolean> {
    const { rowCount } = await this.db.query(`DELETE FROM ${this.kind} WHERE id = $1`, [id]);
    return (rowCount ?? 0) > 0;
  }
}
