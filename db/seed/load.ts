import type { Pool, PoolClient } from 'pg';
import type { SeedData } from './generate';

const CHUNK = 500;
const SEED_ACTOR = 'seed';
const TABLES = ['appointment_event', 'appointment', 'availability_block', 'doctor', 'patient', 'specialization', 'department'];

async function insertRows(client: PoolClient, table: string, columns: string[], rows: unknown[][]): Promise<void> {
  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const marks = row.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${marks.join(', ')})`;
    });
    await client.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`, params);
  }
}

/** True when the database holds no doctors and no patients. */
export async function isEmpty(pool: Pool): Promise<boolean> {
  const { rows } = await pool.query<{ n: string }>(
    'SELECT (SELECT count(*) FROM doctor) + (SELECT count(*) FROM patient) AS n',
  );
  return Number(rows[0]?.n ?? 0) === 0;
}

/** Loads the seed in one transaction. With `reset`, deletes all existing data first. */
export async function loadSeed(pool: Pool, data: SeedData, reset = false): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (reset) await client.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
    const audit = [SEED_ACTOR, SEED_ACTOR];
    await insertRows(client, 'department', ['id', 'name', 'created_by', 'updated_by'],
      data.departments.map((d) => [d.id, d.name, ...audit]));
    await insertRows(client, 'specialization', ['id', 'name', 'created_by', 'updated_by'],
      data.specializations.map((s) => [s.id, s.name, ...audit]));
    await insertRows(client, 'doctor',
      ['id', 'full_name', 'specialization_id', 'department_id', 'phone', 'email', 'fee_paise', 'slot_minutes',
        'created_by', 'updated_by'],
      data.doctors.map((d) => [d.id, d.fullName, d.specializationId, d.departmentId, d.phone, d.email, d.feePaise,
        d.slotMinutes, ...audit]));
    await insertRows(client, 'availability_block', ['doctor_id', 'weekday', 'start_time', 'end_time'],
      data.doctors.flatMap((d) => d.availability.map((b) => [d.id, b.weekday, b.start, b.end])));
    await insertRows(client, 'patient',
      ['id', 'full_name', 'date_of_birth', 'gender', 'phone', 'email', 'blood_group', 'allergies',
        'chronic_conditions', 'current_medications', 'created_by', 'updated_by'],
      data.patients.map((p) => [p.id, p.fullName, p.dateOfBirth, p.gender, p.phone, p.email, p.bloodGroup,
        p.allergies, p.chronicConditions, p.currentMedications, ...audit]));
    await insertRows(client, 'appointment',
      ['id', 'doctor_id', 'patient_id', 'starts_at', 'ends_at', 'reason', 'status', 'cancellation_reason',
        'created_at', 'created_by', 'updated_by'],
      data.appointments.map((a) => [a.id, a.doctorId, a.patientId, a.startsAt, a.endsAt, a.reason, a.status,
        a.cancellationReason, a.bookedAt, ...audit]));
    const events = data.appointments.flatMap((a) => {
      const booked = [a.id, 'BOOKED', null, a.startsAt, null, SEED_ACTOR, a.bookedAt];
      if (a.status === 'SCHEDULED') return [booked];
      const final = a.status === 'NO_SHOW' ? 'NO_SHOW' : a.status;
      const at = a.status === 'CANCELLED' ? a.bookedAt : a.endsAt;
      return [booked, [a.id, final, null, null, a.cancellationReason, SEED_ACTOR, at]];
    });
    await insertRows(client, 'appointment_event',
      ['appointment_id', 'event', 'from_starts_at', 'to_starts_at', 'note', 'actor', 'at'], events);
    for (const t of ['department', 'specialization', 'doctor', 'patient', 'appointment']) {
      await client.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), GREATEST((SELECT max(id) FROM ${t}), 1))`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
