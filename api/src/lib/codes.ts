import { badRequest } from './errors';

/** Display codes are derived from row ids: D-0001 (doctor), P-000001 (patient), A-000001 (appointment). */
const WIDTH = { D: 4, P: 6, A: 6 } as const;
export type CodePrefix = keyof typeof WIDTH;

export function formatCode(prefix: CodePrefix, id: number): string {
  return `${prefix}-${String(id).padStart(WIDTH[prefix], '0')}`;
}

/** The id inside a code such as "P-000042" (case-insensitive), or null when `value` is not one. */
export function idFromCode(prefix: CodePrefix, value: string): number | null {
  const m = new RegExp(`^${prefix}-?(\\d{1,10})$`, 'i').exec(value.trim());
  const id = m ? Number(m[1]) : 0;
  return id > 0 ? id : null;
}

const ID = /^[1-9]\d{0,9}$/;

/** A positive integer id from a path or query value. */
export function parseId(value: unknown, name: string): number {
  if (typeof value !== 'string' || !ID.test(value)) throw badRequest(`${name} must be a positive integer`);
  return Number(value);
}

export function parseOptionalId(value: unknown, name: string): number | undefined {
  return value === undefined || value === '' ? undefined : parseId(value, name);
}

export function parsePage(value: unknown): number {
  return value === undefined || value === '' ? 1 : parseId(value, 'page');
}
