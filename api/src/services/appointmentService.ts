import type { AppConfig } from '../config';
import { inTransaction, type Database, type Queryable } from '../db';
import { formatCode } from '../lib/codes';
import { conflict, fieldError, notFound, pgError } from '../lib/errors';
import { isSlot } from '../lib/slots';
import { dayBounds, MINUTE } from '../lib/time';
import { Fields } from '../lib/validate';
import { AppointmentRepo } from '../repositories/appointmentRepo';
import { DoctorRepo } from '../repositories/doctorRepo';
import { PatientRepo } from '../repositories/patientRepo';
import { APPOINTMENT_STATUSES, type AppointmentDetail, type AppointmentSummary, type Page } from '../types';

const SLOT_TAKEN = 'This slot is no longer available';
const PATIENT_BUSY = 'The patient already has an appointment at that time';

/** PRD §4.3, APT-1..11. */
export class AppointmentService {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly clock: () => Date,
  ) {}

  /** APT-9: by doctor or patient, date range (hospital-local days) and status. */
  async list(query: Record<string, unknown>, page: number): Promise<Page<AppointmentSummary>> {
    const f = new Fields(query);
    const id = (name: string): number | undefined => {
      const v = query[name];
      if (v === undefined || v === '') return undefined;
      const n = Number(v);
      return Number.isInteger(n) && n > 0 ? n : f.fail(name, 'must be an id');
    };
    const doctorId = id('doctorId');
    const patientId = id('patientId');
    const status = f.oneOf('status', APPOINTMENT_STATUSES);
    const from = f.day('from');
    const to = f.day('to');
    if (from && to && from > to) f.fail('to', 'must not be before from');
    f.done();
    const tz = this.config.timeZone;
    const size = this.config.pageSize;
    const { items, total } = await new AppointmentRepo(this.db).list({
      doctorId,
      patientId,
      status,
      from: from ? dayBounds(from, tz).start : undefined,
      to: to ? dayBounds(to, tz).end : undefined,
      limit: size,
      offset: (page - 1) * size,
    });
    return { items, page, page_size: size, total };
  }

  async get(id: number): Promise<AppointmentDetail> {
    const detail = await new AppointmentRepo(this.db).detail(id);
    if (!detail) throw notFound(`Appointment ${formatCode('A', id)} not found`);
    return detail;
  }

  /** APT-1..4. */
  async book(body: Record<string, unknown>, actor: string): Promise<AppointmentDetail> {
    const f = new Fields(body);
    const doctorId = f.int('doctorId', { required: true, min: 1 });
    const patientId = f.int('patientId', { required: true, min: 1 });
    const startsAt = f.instant('startsAt', true);
    const reason = f.optionalText('reason', 300) ?? null;
    f.done();
    const id = await this.guard(() =>
      inTransaction(this.db, async (tx) => {
        const doctor = await new DoctorRepo(tx).get(doctorId!);
        if (!doctor) throw fieldError('doctorId', 'no such doctor');
        if (doctor.status !== 'ACTIVE') throw fieldError('doctorId', 'this doctor is Inactive and cannot be booked');
        const patient = await new PatientRepo(tx).get(patientId!, '1900-01-01');
        if (!patient) throw fieldError('patientId', 'no such patient');
        if (patient.status !== 'ACTIVE') throw fieldError('patientId', 'this patient is Inactive and cannot be booked');
        const endsAt = await this.checkSlot(tx, doctorId!, doctor.slotMinutes, startsAt!);
        const repo = new AppointmentRepo(tx);
        const newId = await repo.insert({ doctorId: doctorId!, patientId: patientId!, startsAt: startsAt!, endsAt, reason }, actor);
        await repo.event(newId, 'BOOKED', actor, { to: startsAt });
        return newId;
      }),
    );
    return this.get(id);
  }

  /** APT-5: same doctor, another free slot; the appointment keeps its id and history. */
  async reschedule(id: number, body: Record<string, unknown>, actor: string): Promise<AppointmentDetail> {
    const f = new Fields(body);
    const startsAt = f.instant('startsAt', true);
    f.done();
    await this.guard(() =>
      inTransaction(this.db, async (tx) => {
        const repo = new AppointmentRepo(tx);
        const current = await this.scheduled(repo, id);
        const doctor = (await new DoctorRepo(tx).get(current.doctor_id))!;
        const endsAt = await this.checkSlot(tx, doctor.id, doctor.slotMinutes, startsAt!);
        await repo.move(id, startsAt!, endsAt, actor);
        await repo.event(id, 'RESCHEDULED', actor, { from: current.starts_at, to: startsAt });
      }),
    );
    return this.get(id);
  }

  /** APT-6: the slot becomes free again because the overlap constraints only cover Scheduled rows. */
  async cancel(id: number, body: Record<string, unknown>, actor: string): Promise<AppointmentDetail> {
    const f = new Fields(body);
    const reason = f.text('reason', { required: true, max: 300 });
    f.done();
    await inTransaction(this.db, async (tx) => {
      const repo = new AppointmentRepo(tx);
      await this.scheduled(repo, id);
      await repo.close(id, 'CANCELLED', reason!, actor);
      await repo.event(id, 'CANCELLED', actor, { note: reason });
    });
    return this.get(id);
  }

  /** APT-7: Completed or No-show, only once the start time has passed. */
  async close(id: number, outcome: 'COMPLETED' | 'NO_SHOW', actor: string): Promise<AppointmentDetail> {
    await inTransaction(this.db, async (tx) => {
      const repo = new AppointmentRepo(tx);
      const current = await this.scheduled(repo, id);
      if (current.starts_at.getTime() > this.clock().getTime()) {
        throw conflict('An appointment can only be closed once its start time has passed');
      }
      await repo.close(id, outcome, null, actor);
      await repo.event(id, outcome, actor);
    });
    return this.get(id);
  }

  /** APT-8: only Scheduled appointments change. Locks the row for the rest of the transaction. */
  private async scheduled(repo: AppointmentRepo, id: number) {
    const current = await repo.get(id, true);
    if (!current) throw notFound(`Appointment ${formatCode('A', id)} not found`);
    if (current.status !== 'SCHEDULED') {
      throw conflict(`This appointment is ${current.status.replace('_', '-').toLowerCase()} and can no longer be changed`);
    }
    return current;
  }

  /** APT-2: a slot of the doctor's availability, in the future. Returns the end time. */
  private async checkSlot(tx: Queryable, doctorId: number, slotMinutes: number, startsAt: Date): Promise<Date> {
    if (startsAt.getTime() <= this.clock().getTime()) throw fieldError('startsAt', 'must be in the future');
    const blocks = await new DoctorRepo(tx).availability(doctorId);
    if (!isSlot(blocks, slotMinutes, startsAt, this.config.timeZone)) {
      throw fieldError('startsAt', "is not one of the doctor's available slots");
    }
    return new Date(startsAt.getTime() + slotMinutes * MINUTE);
  }

  /** APT-3/APT-4: the database's overlap constraints decide races; turn their errors into 409s. */
  private async guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      const { code, constraint } = pgError(err);
      if (code === '23P01' && constraint === 'appointment_doctor_overlap') throw conflict(SLOT_TAKEN);
      if (code === '23P01' && constraint === 'appointment_patient_overlap') throw conflict(PATIENT_BUSY);
      throw err;
    }
  }
}
