import type {
  AppointmentDetail, AppointmentSummary, AvailabilityBlock, Dashboard, DaySchedule, DoctorDetail, DoctorListRow, DoctorSummary, Page,
  PatientDetail, PatientListItem, Period, RefEntry, Settings,
} from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** One message per invalid field (400 VALIDATION). */
    readonly fields: Record<string, string> = {},
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function send<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: { Accept: 'application/json', ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let error: { message?: string; fields?: Record<string, string> } & Record<string, unknown> = {};
    try {
      error = ((await res.json()) as { error?: typeof error }).error ?? {};
      if (error.message) message = error.message;
    } catch {
      // keep the generic message
    }
    throw new ApiError(res.status, message, error.fields ?? {}, error);
  }
  return (await res.json()) as T;
}

export function query(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const api = {
  settings: () => send<Settings>('/api/settings'),
  dashboard: (period: Period) => send<Dashboard>(`/api/dashboard${query({ period })}`),

  references: (kind: 'departments' | 'specializations') => send<{ items: RefEntry[] }>(`/api/${kind}`).then((r) => r.items),
  createReference: (kind: 'departments' | 'specializations', name: string) =>
    send<RefEntry>(`/api/${kind}`, { method: 'POST', body: { name } }),
  updateReference: (kind: 'departments' | 'specializations', id: number, patch: Partial<Pick<RefEntry, 'name' | 'status'>>) =>
    send<RefEntry>(`/api/${kind}/${id}`, { method: 'PATCH', body: patch }),
  deleteReference: (kind: 'departments' | 'specializations', id: number) =>
    send<void>(`/api/${kind}/${id}`, { method: 'DELETE' }),

  doctors: (params: Record<string, string | number | undefined>) => send<Page<DoctorSummary>>(`/api/doctors${query(params)}`),
  doctorsWithToday: (params: Record<string, string | number | undefined>) =>
    send<Page<DoctorListRow>>(`/api/doctors${query({ ...params, with_today: 'true' })}`),
  doctor: (id: number | string) => send<DoctorDetail>(`/api/doctors/${id}`),
  createDoctor: (body: unknown) => send<DoctorDetail>('/api/doctors', { method: 'POST', body }),
  updateDoctor: (id: number, body: unknown) => send<DoctorDetail>(`/api/doctors/${id}`, { method: 'PATCH', body }),
  setAvailability: (id: number, availability: AvailabilityBlock[]) =>
    send<DoctorDetail>(`/api/doctors/${id}/availability`, { method: 'PUT', body: { availability } }),
  deleteDoctor: (id: number) => send<void>(`/api/doctors/${id}`, { method: 'DELETE' }),
  schedule: (id: number | string, date: string) => send<DaySchedule>(`/api/doctors/${id}/slots${query({ date })}`),

  patients: (params: Record<string, string | number | undefined>) => send<Page<PatientListItem>>(`/api/patients${query(params)}`),
  patient: (id: number | string) => send<PatientDetail>(`/api/patients/${id}`),
  createPatient: (body: unknown) => send<PatientDetail>('/api/patients', { method: 'POST', body }),
  updatePatient: (id: number, body: unknown) => send<PatientDetail>(`/api/patients/${id}`, { method: 'PATCH', body }),
  deletePatient: (id: number) => send<void>(`/api/patients/${id}`, { method: 'DELETE' }),

  appointments: (params: Record<string, string | number | undefined>) =>
    send<Page<AppointmentSummary>>(`/api/appointments${query(params)}`),
  appointment: (id: number | string) => send<AppointmentDetail>(`/api/appointments/${id}`),
  book: (body: { doctorId: number; patientId: number; startsAt: string; reason?: string }) =>
    send<AppointmentDetail>('/api/appointments', { method: 'POST', body }),
  reschedule: (id: number, startsAt: string) =>
    send<AppointmentDetail>(`/api/appointments/${id}/reschedule`, { method: 'POST', body: { startsAt } }),
  cancel: (id: number, reason: string) => send<AppointmentDetail>(`/api/appointments/${id}/cancel`, { method: 'POST', body: { reason } }),
  complete: (id: number) => send<AppointmentDetail>(`/api/appointments/${id}/complete`, { method: 'POST' }),
  noShow: (id: number) => send<AppointmentDetail>(`/api/appointments/${id}/no-show`, { method: 'POST' }),
};
