import type { Queryable } from '../db';
import { formatCode } from '../lib/codes';
import { SUMMARY_SELECT, toSummary } from './appointmentRepo';
import type { AppointmentSummary, AvailabilityBlock, DoctorSummary, RecordStatus } from '../types';

interface Row {
  id: number;
  full_name: string;
  specialization_id: number;
  specialization_name: string;
  specialization_status: RecordStatus;
  department_id: number;
  department_name: string;
  department_status: RecordStatus;
  phone: string;
  email: string | null;
  fee_paise: number;
  slot_minutes: number;
  status: RecordStatus;
}

const SELECT = `
  SELECT d.id, d.full_name, d.specialization_id, s.name AS specialization_name, s.status AS specialization_status,
         d.department_id, dp.name AS department_name, dp.status AS department_status,
         d.phone, d.email, d.fee_paise, d.slot_minutes, d.status
    FROM doctor d
    JOIN specialization s ON s.id = d.specialization_id
    JOIN department dp ON dp.id = d.department_id`;

const toSummary_ = (r: Row): DoctorSummary => ({
  id: r.id,
  code: formatCode('D', r.id),
  fullName: r.full_name,
  specialization: { id: r.specialization_id, name: r.specialization_name, status: r.specialization_status },
  department: { id: r.department_id, name: r.department_name, status: r.department_status },
  phone: r.phone,
  email: r.email,
  feePaise: r.fee_paise,
  slotMinutes: r.slot_minutes,
  status: r.status,
});

export interface DoctorFields {
  fullName: string;
  specializationId: number;
  departmentId: number;
  phone: string;
  email: string | null;
  feePaise: number;
  slotMinutes: number;
  status: RecordStatus;
}

export interface DoctorFilter {
  q?: { text: string; id: number | null };
  departmentId?: number;
  specializationId?: number;
  status?: RecordStatus;
  limit: number;
  offset: number;
}

const COLUMNS: Record<keyof DoctorFields, string> = {
  fullName: 'full_name',
  specializationId: 'specialization_id',
  departmentId: 'department_id',
  phone: 'phone',
  email: 'email',
  feePaise: 'fee_paise',
  slotMinutes: 'slot_minutes',
  status: 'status',
};

export class DoctorRepo {
  constructor(private readonly db: Queryable) {}

  async list(f: DoctorFilter): Promise<{ items: DoctorSummary[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const p = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };
    if (f.q) {
      const byName = `d.full_name ILIKE ${p(`%${f.q.text.replace(/[\\%_]/g, '\\$&')}%`)}`;
      where.push(f.q.id ? `(${byName} OR d.id = ${p(f.q.id)})` : byName);
    }
    if (f.departmentId !== undefined) where.push(`d.department_id = ${p(f.departmentId)}`);
    if (f.specializationId !== undefined) where.push(`d.specialization_id = ${p(f.specializationId)}`);
    if (f.status !== undefined) where.push(`d.status = ${p(f.status)}`);
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number((await this.db.query<{ n: string }>(`SELECT count(*) AS n FROM doctor d ${clause}`, params)).rows[0]?.n ?? 0);
    const rows = (
      await this.db.query<Row>(`${SELECT} ${clause} ORDER BY lower(d.full_name), d.id LIMIT ${p(f.limit)} OFFSET ${p(f.offset)}`, params)
    ).rows;
    return { items: rows.map(toSummary_), total };
  }

  async get(id: number, forUpdate = false): Promise<DoctorSummary | null> {
    const row = (await this.db.query<Row>(`${SELECT} WHERE d.id = $1${forUpdate ? ' FOR UPDATE OF d' : ''}`, [id])).rows[0];
    return row ? toSummary_(row) : null;
  }

  async insert(d: DoctorFields, actor: string): Promise<number> {
    const { rows } = await this.db.query<{ id: number }>(
      `INSERT INTO doctor (full_name, specialization_id, department_id, phone, email, fee_paise, slot_minutes, status,
                           created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
      [d.fullName, d.specializationId, d.departmentId, d.phone, d.email, d.feePaise, d.slotMinutes, d.status, actor],
    );
    return rows[0]!.id;
  }

  async update(id: number, patch: Partial<DoctorFields>, actor: string): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const [key, column] of Object.entries(COLUMNS) as Array<[keyof DoctorFields, string]>) {
      if (patch[key] === undefined) continue;
      params.push(patch[key]);
      sets.push(`${column} = $${params.length}`);
    }
    params.push(actor);
    sets.push(`updated_at = now()`, `updated_by = $${params.length}`);
    await this.db.query(`UPDATE doctor SET ${sets.join(', ')} WHERE id = $1`, params);
  }

  async delete(id: number): Promise<void> {
    await this.db.query('DELETE FROM doctor WHERE id = $1', [id]);
  }

  async availability(id: number): Promise<AvailabilityBlock[]> {
    return (
      await this.db.query<{ weekday: number; start: string; end: string }>(
        `SELECT weekday, to_char(start_time, 'HH24:MI') AS start, to_char(end_time, 'HH24:MI') AS "end"
           FROM availability_block WHERE doctor_id = $1 ORDER BY weekday, start_time`,
        [id],
      )
    ).rows;
  }

  async replaceAvailability(id: number, blocks: AvailabilityBlock[]): Promise<void> {
    await this.db.query('DELETE FROM availability_block WHERE doctor_id = $1', [id]);
    for (const b of blocks) {
      await this.db.query(
        'INSERT INTO availability_block (doctor_id, weekday, start_time, end_time) VALUES ($1, $2, $3, $4)',
        [id, b.weekday, b.start, b.end],
      );
    }
  }

  async appointmentCount(id: number): Promise<number> {
    return Number(
      (await this.db.query<{ n: string }>('SELECT count(*) AS n FROM appointment WHERE doctor_id = $1', [id])).rows[0]?.n ?? 0,
    );
  }

  async upcoming(id: number, now: Date, limit = 50): Promise<AppointmentSummary[]> {
    return (
      await this.db.query<Parameters<typeof toSummary>[0]>(
        `${SUMMARY_SELECT} WHERE a.doctor_id = $1 AND a.status = 'SCHEDULED' AND a.starts_at >= $2
          ORDER BY a.starts_at LIMIT $3`,
        [id, now, limit],
      )
    ).rows.map(toSummary);
  }

  async refStatus(kind: 'department' | 'specialization', id: number): Promise<string | null> {
    return (await this.db.query<{ status: string }>(`SELECT status FROM ${kind} WHERE id = $1`, [id])).rows[0]?.status ?? null;
  }
}
