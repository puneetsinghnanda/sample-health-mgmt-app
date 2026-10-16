import { ValidationError } from './errors';
import { isDay } from './time';

/**
 * Collects one message per invalid field, then throws a single ValidationError (PRD §6).
 * Each reader returns the cleaned value, or undefined when the field is absent or invalid.
 */
export class Fields {
  private readonly errors: Record<string, string> = {};

  constructor(
    private readonly body: Record<string, unknown>,
    /** Partial update: absent fields are skipped instead of reported as required. */
    private readonly partial = false,
  ) {}

  has(name: string): boolean {
    return this.body[name] !== undefined;
  }

  fail(name: string, message: string): undefined {
    this.errors[name] ??= message;
    return undefined;
  }

  private absent(name: string, required: boolean): boolean {
    const v = this.body[name];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      if (required && !(this.partial && v === undefined)) this.fail(name, 'is required');
      return true;
    }
    return false;
  }

  text(name: string, opts: { required?: boolean; min?: number; max: number }): string | undefined {
    if (this.absent(name, opts.required ?? false)) return undefined;
    const v = this.body[name];
    if (typeof v !== 'string') return this.fail(name, 'must be text');
    const t = v.trim();
    if (t.length < (opts.min ?? 1)) return this.fail(name, `must be at least ${opts.min ?? 1} characters`);
    if (t.length > opts.max) return this.fail(name, `must be at most ${opts.max} characters`);
    return t;
  }

  /** Text that may be cleared: returns null when sent empty, undefined when absent. */
  optionalText(name: string, max: number): string | null | undefined {
    const v = this.body[name];
    if (v === undefined) return undefined;
    if (v === null || (typeof v === 'string' && v.trim() === '')) return null;
    return this.text(name, { max });
  }

  int(name: string, opts: { required?: boolean; min?: number; max?: number }): number | undefined {
    if (this.absent(name, opts.required ?? false)) return undefined;
    const v = this.body[name];
    if (typeof v !== 'number' || !Number.isInteger(v)) return this.fail(name, 'must be a whole number');
    if (opts.min !== undefined && v < opts.min) return this.fail(name, `must be at least ${opts.min}`);
    if (opts.max !== undefined && v > opts.max) return this.fail(name, `must be at most ${opts.max}`);
    return v;
  }

  oneOf<T extends string | number>(name: string, values: readonly T[], required = false): T | undefined {
    if (this.absent(name, required)) return undefined;
    const v = this.body[name] as T;
    if (!values.includes(v)) return this.fail(name, `must be one of ${values.join(', ')}`);
    return v;
  }

  phone(name: string, required = false): string | undefined {
    const t = this.text(name, { required, max: 25 });
    if (t === undefined) return undefined;
    if (!/^\+?\d{8,15}$/.test(t.replace(/[\s()-]/g, ''))) return this.fail(name, 'must be 8–15 digits, optionally starting with +');
    return t;
  }

  email(name: string): string | null | undefined {
    const t = this.optionalText(name, 254);
    if (!t) return t;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return this.fail(name, 'must be a valid email address');
    return t.toLowerCase();
  }

  day(name: string, required = false): string | undefined {
    if (this.absent(name, required)) return undefined;
    const v = this.body[name];
    if (typeof v !== 'string' || !isDay(v)) return this.fail(name, 'must be a date in YYYY-MM-DD form');
    return v;
  }

  instant(name: string, required = false): Date | undefined {
    if (this.absent(name, required)) return undefined;
    const v = this.body[name];
    const ms = typeof v === 'string' ? Date.parse(v) : Number.NaN;
    if (Number.isNaN(ms)) return this.fail(name, 'must be an ISO 8601 date-time');
    return new Date(ms);
  }

  /** A list of short text items, e.g. allergies. */
  list(name: string, opts: { maxItems: number; maxLength: number }): string[] | undefined {
    const v = this.body[name];
    if (v === undefined || v === null) return v === null ? [] : undefined;
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) return this.fail(name, 'must be a list of text items');
    const items = (v as string[]).map((x) => x.trim()).filter((x) => x !== '');
    if (items.length > opts.maxItems) return this.fail(name, `must have at most ${opts.maxItems} items`);
    if (items.some((x) => x.length > opts.maxLength)) return this.fail(name, `items must be at most ${opts.maxLength} characters`);
    return items;
  }

  bool(name: string): boolean {
    return this.body[name] === true;
  }

  done(): void {
    if (Object.keys(this.errors).length > 0) throw new ValidationError({ ...this.errors });
  }
}

export function bodyOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
