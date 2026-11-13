export type RecordStatus = 'ACTIVE' | 'INACTIVE';
export const RECORD_STATUSES: readonly RecordStatus[] = ['ACTIVE', 'INACTIVE'];

export type AppointmentStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
export const APPOINTMENT_STATUSES: readonly AppointmentStatus[] = ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];

export const GENDERS = ['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED'] as const;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'UNKNOWN'] as const;
export const SLOT_MINUTES = [10, 15, 20, 30, 45, 60] as const;

/** PRD §6: every list answers with this envelope. */
export interface Page<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
}

export interface RefEntry {
  id: number;
  name: string;
  status: RecordStatus;
  doctorCount: number;
}

export interface AvailabilityBlock {
  weekday: number;
  start: string;
  end: string;
}

export interface DoctorSummary {
  id: number;
  code: string;
  fullName: string;
  specialization: { id: number; name: string; status: RecordStatus };
  department: { id: number; name: string; status: RecordStatus };
  phone: string;
  email: string | null;
  feePaise: number;
  slotMinutes: number;
  status: RecordStatus;
}

/** HMS-6: a doctors-list row with the doctor's appointments that start today, except cancelled ones. */
export interface DoctorListRow extends DoctorSummary {
  today_count: number;
}

export interface AppointmentSummary {
  id: number;
  code: string;
  doctor: { id: number; code: string; fullName: string };
  patient: { id: number; code: string; fullName: string };
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
}

export interface DoctorDetail extends DoctorSummary {
  availability: AvailabilityBlock[];
  upcoming: AppointmentSummary[];
  /** DOC-7: Scheduled appointments that no longer fit the weekly availability. */
  outsideAvailability: number[];
  appointmentCount: number;
  /** HMS-7: No-show appointments that start in noShowsWindow (the dashboard's Last 30 days). Read-only. */
  noShowsLast30Days: number;
  /** Hospital-local days (YYYY-MM-DD), inclusive, as the appointment list's from/to filters take them. */
  noShowsWindow: { from: string; to: string };
  /** HMS-9: today to 6 days ahead (hospital-local), counted like the day schedule. Null when Inactive. Read-only. */
  nextSevenDays: NextDay[] | null;
}

/** HMS-9: one day of the doctor's next 7 days. booked and free are null when the day has no slots. */
export interface NextDay {
  date: string;
  available: boolean;
  booked: number | null;
  free: number | null;
}

export interface PatientSummary {
  id: number;
  code: string;
  fullName: string;
  dateOfBirth: string;
  age: number;
  gender: string;
  phone: string;
  status: RecordStatus;
  registeredAt: string;
}

/** HMS-1: the earliest Scheduled appointment that starts after now. */
export interface NextAppointment {
  id: number;
  starts_at: string;
  doctor_name: string;
}

export interface PatientListItem extends PatientSummary {
  next_appointment: NextAppointment | null;
}

export interface PatientDetail extends PatientSummary {
  email: string | null;
  address: string | null;
  emergencyContact: { name: string | null; phone: string | null };
  medicalHistory: {
    bloodGroup: string | null;
    allergies: string[];
    chronicConditions: string[];
    currentMedications: string[];
    notes: string | null;
  };
  appointments: AppointmentSummary[];
}

export interface AppointmentEvent {
  event: string;
  fromStartsAt: string | null;
  toStartsAt: string | null;
  note: string | null;
  actor: string;
  at: string;
}

export interface AppointmentDetail extends AppointmentSummary {
  reason: string | null;
  cancellationReason: string | null;
  history: AppointmentEvent[];
  /** HMS-13: the doctor's current status, so the page can warn when the doctor is Inactive. */
  doctorStatus: RecordStatus;
  /** HMS-13: true only for a not-yet-started Scheduled appointment outside the doctor's weekly availability (DOC-7 rule); otherwise false. */
  outsideAvailability: boolean;
}
