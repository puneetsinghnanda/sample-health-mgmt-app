import type { AppConfig } from '../config';
import { inTransaction, type Database } from '../db';
import { formatCode, idFromCode } from '../lib/codes';
import { conflict, notFound, pgError } from '../lib/errors';
import { addDays, localDay } from '../lib/time';
import { Fields } from '../lib/validate';
import { PatientRepo, type PatientFields } from '../repositories/patientRepo';
import { BLOOD_GROUPS, GENDERS, RECORD_STATUSES, type Page, type PatientDetail, type PatientSummary } from '../types';

const LIST = { maxItems: 20, maxLength: 100 };

/** PRD §4.2, PAT-1..8. */
export class PatientService {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly clock: () => Date,
  ) {}

  private today(): string {
    return localDay(this.clock(), this.config.timeZone);
  }

  async list(query: Record<string, unknown>, page: number): Promise<Page<PatientSummary>> {
    const f = new Fields(query);
    const text = f.text('q', { max: 100 });
    const status = f.oneOf('status', RECORD_STATUSES);
    f.done();
    const size = this.config.pageSize;
    const { items, total } = await new PatientRepo(this.db).list(
      { q: text ? { text, id: idFromCode('P', text) } : undefined, status, limit: size, offset: (page - 1) * size },
      this.today(),
    );
    return { items, page, page_size: size, total };
  }

  async get(id: number): Promise<PatientDetail> {
    const repo = new PatientRepo(this.db);
    const patient = await repo.get(id, this.today());
    if (!patient) throw notFound(`Patient ${formatCode('P', id)} not found`);
    return { ...patient, appointments: await repo.appointments(id, this.clock()) };
  }

  /** PAT-1, with the PAT-5 duplicate warning unless the caller confirms. */
  async create(body: Record<string, unknown>, actor: string): Promise<PatientDetail> {
    const fields = this.read(body, false) as PatientFields;
    const repo = new PatientRepo(this.db);
    if (body.confirmDuplicate !== true) {
      const existing = await repo.findDuplicate(fields.fullName, fields.dateOfBirth, fields.phone);
      if (existing !== null) {
        throw conflict('A patient with the same name, date of birth and phone already exists', {
          reason: 'POSSIBLE_DUPLICATE',
          existing: { id: existing, code: formatCode('P', existing) },
        });
      }
    }
    return this.get(await repo.insert(fields, actor));
  }

  /** PAT-4; status INACTIVE is PAT-6's alternative to deleting. */
  async update(id: number, body: Record<string, unknown>, actor: string): Promise<PatientDetail> {
    const patch = this.read(body, true);
    await inTransaction(this.db, async (tx) => {
      const repo = new PatientRepo(tx);
      if (!(await repo.get(id, this.today(), true))) throw notFound(`Patient ${formatCode('P', id)} not found`);
      await repo.update(id, patch, actor);
    });
    return this.get(id);
  }

  /** PAT-6. */
  async delete(id: number): Promise<void> {
    const repo = new PatientRepo(this.db);
    if (!(await repo.get(id, this.today()))) throw notFound(`Patient ${formatCode('P', id)} not found`);
    const message = 'This patient has appointments and cannot be deleted; set them Inactive instead';
    if ((await repo.appointmentCount(id)) > 0) throw conflict(message);
    try {
      await repo.delete(id);
    } catch (err) {
      if (pgError(err).code === '23503') throw conflict(message);
      throw err;
    }
  }

  private read(body: Record<string, unknown>, partial: boolean): Partial<PatientFields> {
    const f = new Fields(body, partial);
    const today = this.today();
    const dateOfBirth = f.day('dateOfBirth', true);
    if (dateOfBirth && dateOfBirth >= today) f.fail('dateOfBirth', 'must be in the past');
    if (dateOfBirth && dateOfBirth < addDays(today, -Math.ceil(120 * 365.25))) f.fail('dateOfBirth', 'must be within the last 120 years');
    const emergency = typeof body.emergencyContact === 'object' && body.emergencyContact !== null
      ? (body.emergencyContact as Record<string, unknown>) : undefined;
    const ef = new Fields(emergency ?? {}, true);
    const out: Partial<PatientFields> = {
      fullName: f.text('fullName', { required: true, min: 2, max: 100 }),
      dateOfBirth,
      gender: f.oneOf('gender', GENDERS, true),
      phone: f.phone('phone', true),
      email: f.email('email'),
      address: f.optionalText('address', 300),
      emergencyContactName: emergency ? ef.optionalText('name', 100) : undefined,
      emergencyContactPhone: emergency ? (ef.has('phone') && emergency.phone ? ef.phone('phone') : null) : undefined,
      bloodGroup: body.bloodGroup === null || body.bloodGroup === '' ? null : f.oneOf('bloodGroup', BLOOD_GROUPS),
      allergies: f.list('allergies', LIST),
      chronicConditions: f.list('chronicConditions', LIST),
      currentMedications: f.list('currentMedications', LIST),
      medicalNotes: f.optionalText('medicalNotes', 2000),
      status: f.oneOf('status', RECORD_STATUSES),
    };
    try {
      ef.done();
    } catch {
      f.fail('emergencyContact', 'name must be at most 100 characters and phone 8–15 digits');
    }
    f.done();
    if (!partial) {
      out.status ??= 'ACTIVE';
      out.allergies ??= [];
      out.chronicConditions ??= [];
      out.currentMedications ??= [];
      out.email ??= null;
      out.address ??= null;
      out.emergencyContactName ??= null;
      out.emergencyContactPhone ??= null;
      out.bloodGroup ??= null;
      out.medicalNotes ??= null;
    }
    return out;
  }
}
