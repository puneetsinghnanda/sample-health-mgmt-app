import { createHash } from 'node:crypto';
import { addDays, isoWeekday, localDay, MINUTE, zonedToUtc } from '../../api/src/lib/time';

/**
 * Deterministic, invented seed data for the Hospital Management System (PRD NFR-7).
 * Names are made up from short lists, emails use example.com, and phone numbers come from an
 * unassigned "+91 00000" range, so nothing here can belong to a real person.
 */

export const DEFAULT_SEED = 20261016;
export const DEFAULT_TZ = 'Asia/Kolkata';

export interface SeedRef { id: number; name: string }
export interface SeedBlock { weekday: number; start: string; end: string }
export interface SeedDoctor {
  id: number; fullName: string; specializationId: number; departmentId: number; phone: string; email: string;
  feePaise: number; slotMinutes: number; availability: SeedBlock[];
}
export interface SeedPatient {
  id: number; fullName: string; dateOfBirth: string; gender: string; phone: string; email: string;
  bloodGroup: string; allergies: string[]; chronicConditions: string[]; currentMedications: string[];
}
export interface SeedAppointment {
  id: number; doctorId: number; patientId: number; startsAt: string; endsAt: string; reason: string;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW'; cancellationReason: string | null; bookedAt: string;
}
export interface SeedData {
  departments: SeedRef[];
  specializations: SeedRef[];
  doctors: SeedDoctor[];
  patients: SeedPatient[];
  appointments: SeedAppointment[];
}

const DEPARTMENTS = ['Outpatient', 'Emergency', 'Surgery', 'Paediatrics', 'Diagnostics'];
const SPECIALIZATIONS = [
  'General Medicine', 'Cardiology', 'Dermatology', 'Orthopaedics', 'Paediatrics', 'ENT', 'Neurology', 'Gynaecology',
];
const FIRST = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Isha', 'Vivaan', 'Anaya', 'Arjun', 'Kiara', 'Dev', 'Tara',
  'Neel', 'Riya', 'Yash', 'Sara', 'Om', 'Zoya', 'Veer', 'Pia'];
const LAST = ['Testwal', 'Demorao', 'Samplekar', 'Mockerjee', 'Fictiva', 'Placeholdar', 'Inventa', 'Dummysen'];
const ALLERGIES = ['Penicillin', 'Peanuts', 'Dust', 'Latex', 'Sulfa drugs'];
const CONDITIONS = ['Hypertension', 'Type 2 diabetes', 'Asthma', 'Hypothyroidism', 'Migraine'];
const MEDICATIONS = ['Metformin 500 mg', 'Amlodipine 5 mg', 'Salbutamol inhaler', 'Levothyroxine 50 mcg'];
const REASONS = ['Follow-up visit', 'Fever and cough', 'Routine check-up', 'Back pain', 'Skin rash', 'Headache',
  'Blood pressure review', 'Vaccination'];
const CANCEL_REASONS = ['Patient requested', 'Doctor unavailable', 'Rescheduled by phone'];
const GENDERS = ['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED'];
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'UNKNOWN'];
const SLOTS = [15, 15, 20, 30];
const DOCTOR_COUNT = 12;
const PATIENT_COUNT = 200;
const DAYS_BACK = 21;
const DAYS_AHEAD = 14;

/** mulberry32: small, fast, deterministic PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** SEED_ANCHOR: "now" (default for the shared environment) or a fixed ISO instant (tests, demos). */
export function resolveAnchor(value: string | undefined, now: Date = new Date()): Date {
  if (value === undefined || value === '' || value === 'now') return now;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error('SEED_ANCHOR must be "now" or an ISO 8601 timestamp');
  return new Date(ms);
}

function phone(n: number): string {
  return `+91 00000 ${String(n).padStart(5, '0')}`;
}

export function generateSeed(seed: number = DEFAULT_SEED, anchor: Date = new Date('2026-10-16T06:30:00Z'),
  tz: string = DEFAULT_TZ): SeedData {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const some = <T>(xs: readonly T[], p: number): T[] => xs.filter(() => r() < p);

  const departments = DEPARTMENTS.map((name, i) => ({ id: i + 1, name }));
  const specializations = SPECIALIZATIONS.map((name, i) => ({ id: i + 1, name }));

  const doctors: SeedDoctor[] = [];
  for (let i = 1; i <= DOCTOR_COUNT; i++) {
    const morning = { start: '09:00', end: '13:00' };
    const afternoon = { start: '14:00', end: '17:00' };
    const availability: SeedBlock[] = [];
    for (let wd = 1; wd <= 5; wd++) {
      availability.push({ weekday: wd, ...morning });
      if ((i + wd) % 2 === 0) availability.push({ weekday: wd, ...afternoon });
    }
    if (i % 3 === 0) availability.push({ weekday: 6, start: '09:00', end: '12:00' });
    doctors.push({
      id: i,
      fullName: `Dr. ${FIRST[(i * 7) % FIRST.length]} ${LAST[i % LAST.length]}`,
      specializationId: ((i - 1) % SPECIALIZATIONS.length) + 1,
      departmentId: ((i - 1) % DEPARTMENTS.length) + 1,
      phone: phone(10_000 + i),
      email: `doctor${String(i).padStart(2, '0')}@example.com`,
      feePaise: (300 + Math.floor(r() * 10) * 100) * 100,
      slotMinutes: pick(SLOTS),
      availability,
    });
  }

  const anchorDay = localDay(anchor, tz);
  const patients: SeedPatient[] = [];
  for (let i = 1; i <= PATIENT_COUNT; i++) {
    const age = 1 + Math.floor(r() * 85);
    const dob = addDays(anchorDay, -(age * 365 + Math.floor(r() * 365)));
    patients.push({
      id: i,
      fullName: `${pick(FIRST)} ${pick(LAST)}`,
      dateOfBirth: dob,
      gender: pick(GENDERS),
      phone: phone(20_000 + i),
      email: `patient${String(i).padStart(3, '0')}@example.com`,
      bloodGroup: pick(BLOOD),
      allergies: some(ALLERGIES, 0.1),
      chronicConditions: some(CONDITIONS, 0.12),
      currentMedications: some(MEDICATIONS, 0.1),
    });
  }

  // Appointments: a few per doctor per working day around the anchor, never overlapping for a doctor or a patient.
  const appointments: SeedAppointment[] = [];
  const busy = new Map<number, Array<[number, number]>>();
  const patientFree = (pid: number, s: number, e: number): boolean =>
    !(busy.get(pid) ?? []).some(([bs, be]) => s < be && bs < e);
  for (let offset = -DAYS_BACK; offset <= DAYS_AHEAD; offset++) {
    const day = addDays(anchorDay, offset);
    const wd = isoWeekday(day);
    for (const d of doctors) {
      for (const block of d.availability.filter((b) => b.weekday === wd)) {
        const [sh, sm] = block.start.split(':').map(Number) as [number, number];
        const [eh, em] = block.end.split(':').map(Number) as [number, number];
        for (let m = sh * 60 + sm; m + d.slotMinutes <= eh * 60 + em; m += d.slotMinutes) {
          if (r() > 0.25) continue;
          const start = zonedToUtc(day, m, tz).getTime();
          const end = start + d.slotMinutes * MINUTE;
          let pid = 1 + Math.floor(r() * PATIENT_COUNT);
          for (let tries = 0; tries < 5 && !patientFree(pid, start, end); tries++) pid = 1 + Math.floor(r() * PATIENT_COUNT);
          if (!patientFree(pid, start, end)) continue;
          busy.set(pid, [...(busy.get(pid) ?? []), [start, end]]);
          const past = end <= anchor.getTime();
          const roll = r();
          const status: SeedAppointment['status'] = past
            ? roll < 0.8 ? 'COMPLETED' : roll < 0.92 ? 'CANCELLED' : 'NO_SHOW'
            : start > anchor.getTime() ? (roll < 0.9 ? 'SCHEDULED' : 'CANCELLED') : 'SCHEDULED';
          appointments.push({
            id: appointments.length + 1,
            doctorId: d.id,
            patientId: pid,
            startsAt: new Date(start).toISOString(),
            endsAt: new Date(end).toISOString(),
            reason: pick(REASONS),
            status,
            cancellationReason: status === 'CANCELLED' ? pick(CANCEL_REASONS) : null,
            bookedAt: new Date(Math.min(start, anchor.getTime()) - (1 + Math.floor(r() * 10)) * 86_400_000).toISOString(),
          });
        }
      }
    }
  }
  return { departments, specializations, doctors, patients, appointments };
}

export function seedHash(data: SeedData): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}
