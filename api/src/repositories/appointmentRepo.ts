import type { Queryable } from '../db';
import { formatCode } from '../lib/codes';
import type { AppointmentDetail, AppointmentEvent, AppointmentStatus, AppointmentSummary } from '../types';

interface SummaryRow {
  id: number;
  doctor_id: number;
  doctor_name: string;
  patient_id: number;
  patient_name: string;
  starts_at: Date;
  ends_at: Date;
  status: AppointmentStatus;
}

interface DetailRow extends SummaryRow {
  reason: string | null;
  cancellation_reason: string | null;
}

export const SUMMARY_SELECT = `
  SELECT a.id, a.doctor_id, d.full_name AS doctor_name, a.patient_id, p.full_name AS patient_name,
         a.starts_at, a.ends_at, a.status, a.reason, a.cancellation_reason
    FROM appointment a
    JOIN doctor d ON d.id = a.doctor_id
    JOIN patient p ON p.id = a.patient_id`;

export function toSummary(r: SummaryRow): AppointmentSummary {
  return {
    id: r.id,
    code: formatCode('A', r.id),
    doctor: { id: r.doctor_id, code: formatCode('D', r.doctor_id), fullName: r.doctor_name },
    patient: { id: r.patient_id, code: formatCode('P', r.patient_id), fullName: r.patient_name },
    startsAt: r.starts_at.toISOString(),
    endsAt: r.ends_at.toISOString(),
    status: r.status,
  };
}

export interface AppointmentFilter {
  doctorId?: number;
  patientId?: number;
  status?: AppointmentStatus;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

export interface NewAppointment {
  doctorId: number;
  patientId: number;
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
}

export class AppointmentRepo {
  constructor(private readonly db: Queryable) {}

  async list(f: AppointmentFilter): Promise<{ items: AppointmentSummary[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown): void => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (f.doctorId !== undefined) add('a.doctor_id = ?', f.doctorId);
    if (f.patientId !== undefined) add('a.patient_id = ?', f.patientId);
    if (f.status !== undefined) add('a.status = ?', f.status);
    if (f.from !== undefined) add('a.starts_at >= ?', f.from);
    if (f.to !== undefined) add('a.starts_at < ?', f.to);
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number(
      (await this.db.query<{ n: string }>(`SELECT count(*) AS n FROM appointment a ${clause}`, params)).rows[0]?.n ?? 0,
    );
    const rows = (
      await this.db.query<SummaryRow>(
        `${SUMMARY_SELECT} ${clause} ORDER BY a.starts_at, a.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, f.limit, f.offset],
      )
    ).rows;
    return { items: rows.map(toSummary), total };
  }

  async get(id: number, forUpdate = false): Promise<DetailRow | null> {
    const lock = forUpdate ? ' FOR UPDATE OF a' : '';
    return (await this.db.query<DetailRow>(`${SUMMARY_SELECT} WHERE a.id = $1${lock}`, [id])).rows[0] ?? null;
  }

  async detail(id: number): Promise<AppointmentDetail | null> {
    const row = await this.get(id);
    if (!row) return null;
    const history = (
      await this.db.query<{ event: string; from_starts_at: Date | null; to_starts_at: Date | null; note: string | null; actor: string; at: Date }>(
        `SELECT event, from_starts_at, to_starts_at, note, actor, at FROM appointment_event
          WHERE appointment_id = $1 ORDER BY at, id`,
        [id],
      )
    ).rows.map(
      (e): AppointmentEvent => ({
        event: e.event,
        fromStartsAt: e.from_starts_at?.toISOString() ?? null,
        toStartsAt: e.to_starts_at?.toISOString() ?? null,
        note: e.note,
        actor: e.actor,
        at: e.at.toISOString(),
      }),
    );
    return { ...toSummary(row), reason: row.reason, cancellationReason: row.cancellation_reason, history };
  }

  /** Appointments of one doctor that overlap [from, to), except cancelled ones. */
  async occupyingBetween(doctorId: number, from: Date, to: Date): Promise<AppointmentSummary[]> {
    return (
      await this.db.query<SummaryRow>(
        `${SUMMARY_SELECT} WHERE a.doctor_id = $1 AND a.status <> 'CANCELLED' AND a.starts_at < $3 AND a.ends_at > $2
          ORDER BY a.starts_at`,
        [doctorId, from, to],
      )
    ).rows.map(toSummary);
  }

  /** HMS-6: per doctor, the appointments that start in [from, to), except cancelled ones. */
  async countTodayByDoctor(doctorIds: number[], from: Date, to: Date): Promise<Map<number, number>> {
    if (doctorIds.length === 0) return new Map();
    const { rows } = await this.db.query<{ doctor_id: number; n: string }>(
      `SELECT doctor_id, count(*) AS n FROM appointment
        WHERE doctor_id = ANY($1::int[]) AND starts_at >= $2 AND starts_at < $3 AND status <> 'CANCELLED'
        GROUP BY doctor_id`,
      [doctorIds, from, to],
    );
    return new Map(rows.map((r) => [r.doctor_id, Number(r.n)]));
  }

  async insert(a: NewAppointment, actor: string): Promise<number> {
    const { rows } = await this.db.query<{ id: number }>(
      `INSERT INTO appointment (doctor_id, patient_id, starts_at, ends_at, reason, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
      [a.doctorId, a.patientId, a.startsAt, a.endsAt, a.reason, actor],
    );
    return rows[0]!.id;
  }

  async move(id: number, startsAt: Date, endsAt: Date, actor: string): Promise<void> {
    await this.db.query(
      'UPDATE appointment SET starts_at = $2, ends_at = $3, updated_at = now(), updated_by = $4 WHERE id = $1',
      [id, startsAt, endsAt, actor],
    );
  }

  async close(id: number, status: Exclude<AppointmentStatus, 'SCHEDULED'>, cancellationReason: string | null,
    actor: string): Promise<void> {
    await this.db.query(
      `UPDATE appointment SET status = $2, cancellation_reason = $3, updated_at = now(), updated_by = $4 WHERE id = $1`,
      [id, status, cancellationReason, actor],
    );
  }

  async event(id: number, event: string, actor: string,
    extra: { from?: Date | null; to?: Date | null; note?: string | null } = {}): Promise<void> {
    await this.db.query(
      `INSERT INTO appointment_event (appointment_id, event, from_starts_at, to_starts_at, note, actor)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, event, extra.from ?? null, extra.to ?? null, extra.note ?? null, actor],
    );
  }
}
