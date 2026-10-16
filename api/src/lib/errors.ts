export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** 400 with one message per invalid field (PRD §6). */
export class ValidationError extends HttpError {
  constructor(readonly fields: Record<string, string>) {
    super(400, 'VALIDATION', 'Some fields are not valid', { fields });
    this.name = 'ValidationError';
  }
}

export const badRequest = (message: string): HttpError => new HttpError(400, 'BAD_REQUEST', message);
export const fieldError = (field: string, message: string): ValidationError => new ValidationError({ [field]: message });
export const notFound = (message: string): HttpError => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (message: string, details?: Record<string, unknown>): HttpError =>
  new HttpError(409, 'CONFLICT', message, details);
export const forbidden = (message: string): HttpError => new HttpError(403, 'FORBIDDEN', message);

/** PostgreSQL error with its SQLSTATE code and constraint name. */
export function pgError(err: unknown): { code?: string; constraint?: string } {
  return typeof err === 'object' && err !== null ? (err as { code?: string; constraint?: string }) : {};
}
