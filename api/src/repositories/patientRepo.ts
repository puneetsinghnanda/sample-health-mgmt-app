import type { Queryable } from '../db';
import { formatCode } from '../lib/codes';
import { SUMMARY_SELECT, toSummary } from './appointmentRepo';
import type { AppointmentSummary, PatientDetail, PatientListItem, PatientSummary, RecordStatus } from '../types';

interface Row {
  id: number;
  full_name: string;
  date_of_birth: string;
  gender: string;
  phone: string;
  status: RecordStatus;
  created_at: Date;
}

interface ListRow extends Row {
  next_id: number | null;
  next_starts_at: Date | null;
  next_doctor_name: string | null;
}

interface DetailRow extends Row {
  email: string | null;
  address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  blood_group: string | null;
  allergies: string[];
  chronic_conditions: string[];
  current_medications: string[];
  medical_notes: string | null;
}

// PAT-8: the list query never selects medical history columns.
const LIST_COLUMNS = `id, full_name, to_char(date_of_birth, 'YYYY-MM-DD') AS date_of_birth, gender, phone, status, created_at`;
/** Digits and a leading + only, so "+91 00000 20001" and "+910000020001" compare equal. */
const NORMALIZED_PHONE = `regexp_replace(phone, '[^0-9+]', '', 'g')`;

export function ageOn(dateOfBirth: string, today: string): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

export interface PatientFields {
  fullName: string;
  dateOfBirth: string;
  gender: string;
  phone: string;
  email: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  bloodGroup: string | null;
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
  medicalNotes: string | null;
  status: RecordStatus;
}

const COLUMNS: Record<keyof PatientFields, string> = {
  fullName: 'full_name',
  dateOfBirth: 'date_of_birth',
  gender: 'gender',
  phone: 'phone',
  email: 'email',
  address: 'address',
  emergencyContactName: 'emergency_contact_name',
  emergencyContactPhone: 'emergency_contact_phone',
  bloodGroup: 'blood_group',
  allergies: 'allergies',
  chronicConditions: 'chronic_conditions',
  currentMedications: 'current_medications',
  medicalNotes: 'medical_notes',
  status: 'status',
};

export function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9+]/g, '');
}

export class PatientRepo {
  constructor(private readonly db: Queryable) {}

  private summary(r: Row, today: string): PatientSummary {
    return {
      id: r.id,
      code: formatCode('P', r.id),
      fullName: r.full_name,
      dateOfBirth: r.date_of_birth,
      age: ageOn(r.date_of_birth, today),
      gender: r.gender,
      phone: r.phone,
      status: r.status,
      registeredAt: r.created_at.toISOString(),
    };
  }

  /** HMS-1: each item also carries its earliest Scheduled appointment starting after `now`, in one query per page. */
  async list(f: { q?: { text: string; id: number | null }; status?: RecordStatus; limit: number; offset: number },
    today: string, now: Date): Promise<{ items: PatientListItem[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const p = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };
    if (f.q) {
      const like = p(`%${f.q.text.replace(/[\\%_]/g, '\\$&')}%`);
      const digits = normalizePhone(f.q.text);
      const parts = [`full_name ILIKE ${like}`];
      if (digits.replace('+', '').length >= 4) parts.push(`${NORMALIZED_PHONE} LIKE ${p(`%${digits}%`)}`);
      if (f.q.id) parts.push(`id = ${p(f.q.id)}`);
      where.push(`(${parts.join(' OR ')})`);
    }
    if (f.status) where.push(`status = ${p(f.status)}`);
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number((await this.db.query<{ n: string }>(`SELECT count(*) AS n FROM patient ${clause}`, params)).rows[0]?.n ?? 0);
    const page = `SELECT ${LIST_COLUMNS} FROM patient ${clause} ORDER BY created_at DESC, id DESC LIMIT ${p(f.limit)} OFFSET ${p(f.offset)}`;
    const rows = (
      await this.db.query<ListRow>(
        `SELECT pg.*, n.id AS next_id, n.starts_at AS next_starts_at, n.doctor_name AS next_doctor_name
           FROM (${page}) pg
           LEFT JOIN LATERAL (
             SELECT a.id, a.starts_at, d.full_name AS doctor_name
               FROM appointment a
               JOIN doctor d ON d.id = a.doctor_id
              WHERE a.patient_id = pg.id AND a.status = 'SCHEDULED' AND a.starts_at > ${p(now)}
              ORDER BY a.starts_at, a.id
              LIMIT 1
           ) n ON true
          ORDER BY pg.created_at DESC, pg.id DESC`,
        params,
      )
    ).rows;
    return {
      items: rows.map((r) => ({
        ...this.summary(r, today),
        next_appointment: r.next_id === null || r.next_starts_at === null || r.next_doctor_name === null
          ? null
          : { id: r.next_id, starts_at: r.next_starts_at.toISOString(), doctor_name: r.next_doctor_name },
      })),
      total,
    };
  }

  async get(id: number, today: string, forUpdate = false): Promise<Omit<PatientDetail, 'appointments'> | null> {
    const r = (
      await this.db.query<DetailRow>(
        `SELECT ${LIST_COLUMNS}, email, address, emergency_contact_name, emergency_contact_phone, blood_group,
                allergies, chronic_conditions, current_medications, medical_notes
           FROM patient WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
        [id],
      )
    ).rows[0];
    if (!r) return null;
    return {
      ...this.summary(r, today),
      email: r.email,
      address: r.address,
      emergencyContact: { name: r.emergency_contact_name, phone: r.emergency_contact_phone },
      medicalHistory: {
        bloodGroup: r.blood_group,
        allergies: r.allergies,
        chronicConditions: r.chronic_conditions,
        currentMedications: r.current_medications,
        notes: r.medical_notes,
      },
    };
  }

  /** PAT-5: an existing patient with the same name, date of birth and phone. */
  async findDuplicate(fullName: string, dateOfBirth: string, phone: string): Promise<number | null> {
    return (
      (
        await this.db.query<{ id: number }>(
          `SELECT id FROM patient WHERE lower(full_name) = lower($1) AND date_of_birth = $2 AND ${NORMALIZED_PHONE} = $3
            ORDER BY id LIMIT 1`,
          [fullName, dateOfBirth, normalizePhone(phone)],
        )
      ).rows[0]?.id ?? null
    );
  }

  async insert(p: PatientFields, actor: string): Promise<number> {
    const keys = Object.keys(COLUMNS) as Array<keyof PatientFields>;
    const values = keys.map((k) => p[k]);
    const { rows } = await this.db.query<{ id: number }>(
      `INSERT INTO patient (${keys.map((k) => COLUMNS[k]).join(', ')}, created_by, updated_by)
       VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}, $${keys.length + 1}, $${keys.length + 1}) RETURNING id`,
      [...values, actor],
    );
    return rows[0]!.id;
  }

  async update(id: number, patch: Partial<PatientFields>, actor: string): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const [key, column] of Object.entries(COLUMNS) as Array<[keyof PatientFields, string]>) {
      if (patch[key] === undefined) continue;
      params.push(patch[key]);
      sets.push(`${column} = $${params.length}`);
    }
    params.push(actor);
    sets.push('updated_at = now()', `updated_by = $${params.length}`);
    await this.db.query(`UPDATE patient SET ${sets.join(', ')} WHERE id = $1`, params);
  }

  async delete(id: number): Promise<void> {
    await this.db.query('DELETE FROM patient WHERE id = $1', [id]);
  }

  async appointmentCount(id: number): Promise<number> {
    return Number(
      (await this.db.query<{ n: string }>('SELECT count(*) AS n FROM appointment WHERE patient_id = $1', [id])).rows[0]?.n ?? 0,
    );
  }

  /** PAT-3: upcoming first (soonest first), then past (most recent first). */
  async appointments(id: number, now: Date, limit = 100): Promise<AppointmentSummary[]> {
    return (
      await this.db.query<Parameters<typeof toSummary>[0]>(
        `${SUMMARY_SELECT} WHERE a.patient_id = $1
          ORDER BY (a.starts_at >= $2) DESC,
                   CASE WHEN a.starts_at >= $2 THEN a.starts_at END ASC,
                   a.starts_at DESC
          LIMIT $3`,
        [id, now, limit],
      )
    ).rows.map(toSummary);
  }
}
