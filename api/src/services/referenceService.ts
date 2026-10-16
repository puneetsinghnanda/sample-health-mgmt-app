import type { Database } from '../db';
import { conflict, notFound, pgError } from '../lib/errors';
import { Fields } from '../lib/validate';
import { ReferenceRepo, type RefKind } from '../repositories/referenceRepo';
import { RECORD_STATUSES, type RefEntry } from '../types';

const LABEL: Record<RefKind, string> = { department: 'Department', specialization: 'Specialization' };

/** PRD §4.5, REF-1..4. */
export class ReferenceService {
  private readonly repo: ReferenceRepo;

  constructor(
    db: Database,
    private readonly kind: RefKind,
  ) {
    this.repo = new ReferenceRepo(db, kind);
  }

  list(): Promise<RefEntry[]> {
    return this.repo.list();
  }

  async get(id: number): Promise<RefEntry> {
    const entry = await this.repo.get(id);
    if (!entry) throw notFound(`${LABEL[this.kind]} ${id} not found`);
    return entry;
  }

  async create(body: Record<string, unknown>, actor: string): Promise<RefEntry> {
    const f = new Fields(body);
    const name = f.text('name', { required: true, min: 2, max: 60 });
    f.done();
    const id = await this.unique(() => this.repo.create(name!, actor));
    return this.get(id);
  }

  /** REF-1 rename and REF-2 deactivate. REF-4: doctors reference the id, so a rename shows everywhere. */
  async update(id: number, body: Record<string, unknown>, actor: string): Promise<RefEntry> {
    const f = new Fields(body, true);
    const name = f.text('name', { min: 2, max: 60 });
    const status = f.oneOf('status', RECORD_STATUSES);
    f.done();
    const found = await this.unique(() => this.repo.update(id, { name, status }, actor));
    if (!found) throw notFound(`${LABEL[this.kind]} ${id} not found`);
    return this.get(id);
  }

  /** REF-2: an entry in use cannot be deleted. */
  async delete(id: number): Promise<void> {
    const entry = await this.get(id);
    if (entry.doctorCount > 0) {
      throw conflict(`${LABEL[this.kind]} is used by ${entry.doctorCount} doctor(s); set it Inactive instead`);
    }
    try {
      await this.repo.delete(id);
    } catch (err) {
      if (pgError(err).code === '23503') throw conflict(`${LABEL[this.kind]} is in use; set it Inactive instead`);
      throw err;
    }
  }

  private async unique<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (pgError(err).code === '23505') throw conflict(`${LABEL[this.kind]} with this name already exists`);
      throw err;
    }
  }
}
