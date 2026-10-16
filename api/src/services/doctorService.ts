import type { AppConfig } from '../config';
import { inTransaction, type Database, type Queryable } from '../db';
import { formatCode, idFromCode } from '../lib/codes';
import { conflict, fieldError, notFound, pgError } from '../lib/errors';
import { availabilityProblem, daySlots, withinAvailability } from '../lib/slots';
import { dayBounds } from '../lib/time';
import { Fields } from '../lib/validate';
import { AppointmentRepo } from '../repositories/appointmentRepo';
import { DoctorRepo, type DoctorFields } from '../repositories/doctorRepo';
import {
  RECORD_STATUSES, SLOT_MINUTES, type AppointmentSummary, type AvailabilityBlock, type DoctorDetail,
  type DoctorSummary, type Page, type RecordStatus,
} from '../types';

export interface DaySchedule {
  doctorId: number;
  date: string;
  slotMinutes: number;
  slots: Array<{ start: string; end: string; label: string; state: 'FREE' | 'BOOKED' | 'PAST'; appointment?: AppointmentSummary }>;
  /** Every non-cancelled appointment of the day, including any that no longer sit on the slot grid. */
  appointments: AppointmentSummary[];
}

/** PRD §4.1, DOC-1..7, and the day schedule of APT-10. */
export class DoctorService {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly clock: () => Date,
  ) {}

  async list(query: Record<string, unknown>, page: number): Promise<Page<DoctorSummary>> {
    const f = new Fields(query);
    const departmentId = typeof query.departmentId === 'string' && query.departmentId ? Number(query.departmentId) : undefined;
    const specializationId =
      typeof query.specializationId === 'string' && query.specializationId ? Number(query.specializationId) : undefined;
    if (departmentId !== undefined && !Number.isInteger(departmentId)) f.fail('departmentId', 'must be an id');
    if (specializationId !== undefined && !Number.isInteger(specializationId)) f.fail('specializationId', 'must be an id');
    const status = f.oneOf('status', RECORD_STATUSES);
    const text = f.text('q', { max: 100 });
    f.done();
    const size = this.config.pageSize;
    const { items, total } = await new DoctorRepo(this.db).list({
      q: text ? { text, id: idFromCode('D', text) } : undefined,
      departmentId,
      specializationId,
      status,
      limit: size,
      offset: (page - 1) * size,
    });
    return { items, page, page_size: size, total };
  }

  async get(id: number): Promise<DoctorDetail> {
    const repo = new DoctorRepo(this.db);
    const doctor = await repo.get(id);
    if (!doctor) throw notFound(`Doctor ${formatCode('D', id)} not found`);
    const availability = await repo.availability(id);
    const upcoming = await repo.upcoming(id, this.clock());
    const outsideAvailability = upcoming
      .filter((a) => !withinAvailability(availability, new Date(a.startsAt), new Date(a.endsAt), this.config.timeZone))
      .map((a) => a.id);
    return { ...doctor, availability, upcoming, outsideAvailability, appointmentCount: await repo.appointmentCount(id) };
  }

  /** DOC-1. */
  async create(body: Record<string, unknown>, actor: string): Promise<DoctorDetail> {
    const fields = this.read(body, false) as DoctorFields;
    const availability = this.readAvailability(body.availability, false) ?? [];
    const id = await inTransaction(this.db, async (tx) => {
      await this.checkReferences(tx, fields);
      const repo = new DoctorRepo(tx);
      const newId = await repo.insert(fields, actor);
      await repo.replaceAvailability(newId, availability);
      return newId;
    });
    return this.get(id);
  }

  /** DOC-4; setting status INACTIVE is DOC-5's alternative to deleting. */
  async update(id: number, body: Record<string, unknown>, actor: string): Promise<DoctorDetail> {
    const patch = this.read(body, true);
    await inTransaction(this.db, async (tx) => {
      const repo = new DoctorRepo(tx);
      const current = await repo.get(id, true);
      if (!current) throw notFound(`Doctor ${formatCode('D', id)} not found`);
      // REF-3: an Inactive entry the doctor already has may stay; a newly chosen one must be Active.
      await this.checkReferences(tx, {
        specializationId: patch.specializationId !== current.specialization.id ? patch.specializationId : undefined,
        departmentId: patch.departmentId !== current.department.id ? patch.departmentId : undefined,
      });
      await repo.update(id, patch, actor);
    });
    return this.get(id);
  }

  /** DOC-7: replacing availability never moves or cancels appointments. */
  async replaceAvailability(id: number, body: unknown): Promise<DoctorDetail> {
    const blocks = this.readAvailability(
      typeof body === 'object' && body !== null && 'availability' in body ? (body as { availability: unknown }).availability : body,
      true,
    )!;
    await inTransaction(this.db, async (tx) => {
      const repo = new DoctorRepo(tx);
      if (!(await repo.get(id, true))) throw notFound(`Doctor ${formatCode('D', id)} not found`);
      await repo.replaceAvailability(id, blocks);
    });
    return this.get(id);
  }

  /** DOC-5: only a doctor without appointments can be deleted. */
  async delete(id: number): Promise<void> {
    const repo = new DoctorRepo(this.db);
    if (!(await repo.get(id))) throw notFound(`Doctor ${formatCode('D', id)} not found`);
    if ((await repo.appointmentCount(id)) > 0) {
      throw conflict('This doctor has appointments and cannot be deleted; set them Inactive instead');
    }
    try {
      await repo.delete(id);
    } catch (err) {
      if (pgError(err).code === '23503') throw conflict('This doctor has appointments and cannot be deleted; set them Inactive instead');
      throw err;
    }
  }

  /** APT-10: one day of a doctor's slots, booked and free. */
  async schedule(id: number, date: string): Promise<DaySchedule> {
    const repo = new DoctorRepo(this.db);
    const doctor = await repo.get(id);
    if (!doctor) throw notFound(`Doctor ${formatCode('D', id)} not found`);
    const tz = this.config.timeZone;
    const { start, end } = dayBounds(date, tz);
    const appointments = await new AppointmentRepo(this.db).occupyingBetween(id, start, end);
    const now = this.clock().getTime();
    const slots = daySlots(await repo.availability(id), doctor.slotMinutes, date, tz).map((s) => {
      const taken = appointments.find((a) => Date.parse(a.startsAt) < s.end.getTime() && Date.parse(a.endsAt) > s.start.getTime());
      const state: 'FREE' | 'BOOKED' | 'PAST' = taken ? 'BOOKED' : s.start.getTime() <= now ? 'PAST' : 'FREE';
      return { start: s.start.toISOString(), end: s.end.toISOString(), label: s.label, state, ...(taken ? { appointment: taken } : {}) };
    });
    return { doctorId: id, date, slotMinutes: doctor.slotMinutes, slots, appointments };
  }

  private read(body: Record<string, unknown>, partial: boolean): Partial<DoctorFields> {
    const f = new Fields(body, partial);
    const out: Partial<DoctorFields> = {
      fullName: f.text('fullName', { required: true, min: 2, max: 100 }),
      specializationId: f.int('specializationId', { required: true, min: 1 }),
      departmentId: f.int('departmentId', { required: true, min: 1 }),
      phone: f.phone('phone', true),
      email: f.email('email'),
      feePaise: f.int('feePaise', { required: true, min: 0, max: 100_000_000 }),
      slotMinutes: f.oneOf('slotMinutes', SLOT_MINUTES),
      status: f.oneOf<RecordStatus>('status', RECORD_STATUSES),
    };
    if (!partial) out.slotMinutes ??= 15;
    if (!partial) out.status ??= 'ACTIVE';
    f.done();
    return out;
  }

  private readAvailability(value: unknown, required: boolean): AvailabilityBlock[] | undefined {
    if (value === undefined && !required) return undefined;
    if (!Array.isArray(value)) throw fieldError('availability', 'must be a list of {weekday, start, end} blocks');
    const blocks = value.map((b: unknown) => {
      const x = (typeof b === 'object' && b !== null ? b : {}) as Record<string, unknown>;
      return { weekday: Number(x.weekday), start: String(x.start ?? ''), end: String(x.end ?? '') };
    });
    const problem = availabilityProblem(blocks);
    if (problem) throw fieldError('availability', problem);
    return blocks;
  }

  /** REF-3: a doctor can only be given Active departments and specializations. */
  private async checkReferences(tx: Queryable, f: { specializationId?: number; departmentId?: number }): Promise<void> {
    const repo = new DoctorRepo(tx);
    const errors = new Fields({});
    for (const [field, kind, id] of [
      ['specializationId', 'specialization', f.specializationId],
      ['departmentId', 'department', f.departmentId],
    ] as const) {
      if (id === undefined) continue;
      const status = await repo.refStatus(kind, id);
      if (status === null) errors.fail(field, `no ${kind} with id ${id}`);
      else if (status !== 'ACTIVE') errors.fail(field, `this ${kind} is Inactive`);
    }
    errors.done();
  }
}
