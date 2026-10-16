import type { Express } from 'express';
import type { Pool } from 'pg';
import request from 'supertest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';

process.env.REQUEST_LOG = 'off';

/** Fixed "now" for every test: Monday 19 October 2026, 08:00 in Asia/Kolkata. */
export const NOW = new Date('2026-10-19T02:30:00Z');
export const MONDAY = '2026-10-19';
export const TUESDAY = '2026-10-20';
/** Kolkata is UTC+05:30 all year, so local HH:MM on a day maps to a fixed UTC instant. */
export const at = (day: string, hhmm: string): string => new Date(`${day}T${hhmm}:00+05:30`).toISOString();

export function testApp(pool: Pool, clock: () => Date = () => NOW): Express {
  return createApp(pool, loadConfig({ HOSPITAL_TZ: 'Asia/Kolkata' }), clock);
}

/**
 * Small invented fixture:
 *  - departments 1 Outpatient, 2 Surgery; specializations 1 General Medicine, 2 Cardiology
 *  - doctor 1: 15-minute slots, Mon–Fri 09:00–12:00; doctor 2: 30-minute slots, Mon 09:00–10:00
 *  - patients 1 and 2
 */
export async function loadFixture(app: Express): Promise<void> {
  const ok = async (method: 'post', url: string, body: object): Promise<void> => {
    const res = await request(app)[method](url).send(body);
    if (res.status !== 201) throw new Error(`${url}: ${res.status} ${JSON.stringify(res.body)}`);
  };
  await ok('post', '/api/departments', { name: 'Outpatient' });
  await ok('post', '/api/departments', { name: 'Surgery' });
  await ok('post', '/api/specializations', { name: 'General Medicine' });
  await ok('post', '/api/specializations', { name: 'Cardiology' });
  await ok('post', '/api/doctors', {
    fullName: 'Dr. Test Doctor One', specializationId: 1, departmentId: 1, phone: '+91 00000 10001',
    email: 'doctor01@example.com', feePaise: 50000, slotMinutes: 15,
    availability: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '12:00' })),
  });
  await ok('post', '/api/doctors', {
    fullName: 'Dr. Test Doctor Two', specializationId: 2, departmentId: 2, phone: '+91 00000 10002',
    feePaise: 80000, slotMinutes: 30, availability: [{ weekday: 1, start: '09:00', end: '10:00' }],
  });
  await ok('post', '/api/patients', {
    fullName: 'Test Patient One', dateOfBirth: '1990-05-01', gender: 'FEMALE', phone: '+91 00000 20001',
    allergies: ['Penicillin'], medicalNotes: 'Invented note',
  });
  await ok('post', '/api/patients', {
    fullName: 'Test Patient Two', dateOfBirth: '1985-01-15', gender: 'MALE', phone: '+91 00000 20002',
  });
}

/** Books doctor `doctorId` for patient `patientId` at local `hhmm` on `day`. */
export function book(app: Express, doctorId: number, patientId: number, day: string, hhmm: string) {
  return request(app).post('/api/appointments').send({ doctorId, patientId, startsAt: at(day, hhmm), reason: 'Check-up' });
}
