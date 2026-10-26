// Mirrors api/src/types.ts (the API's response shapes).
export type RecordStatus = 'ACTIVE' | 'INACTIVE';
export type AppointmentStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export interface Page<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
}

export interface Settings {
  timeZone: string;
  currency: string;
  pageSize: number;
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
  outsideAvailability: number[];
  appointmentCount: number;
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

export interface AppointmentDetail extends AppointmentSummary {
  reason: string | null;
  cancellationReason: string | null;
  history: Array<{ event: string; fromStartsAt: string | null; toStartsAt: string | null; note: string | null; actor: string; at: string }>;
}

export interface Slot {
  start: string;
  end: string;
  label: string;
  state: 'FREE' | 'BOOKED' | 'PAST';
  appointment?: AppointmentSummary;
}

export interface DaySchedule {
  doctorId: number;
  date: string;
  slotMinutes: number;
  slots: Slot[];
  appointments: AppointmentSummary[];
}

export type Period = 'today' | '7d' | '30d';

export interface Dashboard {
  today: string;
  period: { name: Period; from: string; to: string };
  totals: { patients: number; doctors: number; appointmentsToday: number; upcoming: number; completed: number; cancelled: number };
  next: AppointmentSummary[];
}
