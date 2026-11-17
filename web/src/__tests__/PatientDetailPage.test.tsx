import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AppointmentSummary, PatientDetail } from '../api/types';
import { PatientDetailPage } from '../pages/PatientDetailPage';

/** 15 Mar 2027 00:10 in Asia/Kolkata is 14 Mar 2027 18:40 UTC: the local date differs from the UTC date. */
const NEXT_START = '2027-03-14T18:40:00.000Z';

const appt = (id: number, startsAt: string, status: AppointmentSummary['status']): AppointmentSummary => ({
  id,
  code: `A-00000${id}`,
  doctor: { id: 1, code: 'D-000001', fullName: 'Test Doctor 001' },
  patient: { id: 1, code: 'P-000001', fullName: 'Test Patient 001' },
  startsAt,
  endsAt: startsAt,
  status,
});

const BASE: PatientDetail = {
  id: 1,
  code: 'P-000001',
  fullName: 'Test Patient 001',
  dateOfBirth: '1990-01-01',
  age: 36,
  gender: 'OTHER',
  phone: '+91 00000 00000',
  status: 'ACTIVE',
  registeredAt: '2026-10-01T04:30:00Z',
  email: null,
  address: null,
  emergencyContact: { name: null, phone: null },
  medicalHistory: { bloodGroup: null, allergies: [], chronicConditions: [], currentMedications: [], notes: null },
  appointments: [appt(7, NEXT_START, 'SCHEDULED'), appt(5, '2026-10-01T04:30:00Z', 'CANCELLED')],
  next_appointment: { id: 7, starts_at: NEXT_START, doctor_name: 'Test Doctor 001' },
};

function renderPage(patient: PatientDetail) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(patient), { status: 200 })));
  render(
    <MemoryRouter initialEntries={['/patients/1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/patients/:id" element={<PatientDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const line = async (): Promise<HTMLElement> => (await screen.findByText(/Next appointment:|No upcoming appointment/)).closest('p')!;

describe('PatientDetailPage next appointment (HMS-15)', () => {
  it('HMS-15 REQ-1, REQ-2, REQ-3: shows "Next appointment:", the date and time as the table shows it, and the doctor', async () => {
    renderPage(BASE);
    const p = await line();
    expect(p.textContent).toMatch(/^Next appointment:/);
    const tableRow = screen.getByText('A-000007').closest('tr')!;
    const tableWhen = within(tableRow).getAllByRole('cell')[1]!.textContent!;
    expect(within(p).getByRole('link').textContent).toBe(tableWhen);
    expect(p.textContent).toContain('Test Doctor 001');
  });

  it('HMS-15 REQ-9: shows the local date (15 Mar), not the UTC date (14 Mar), for an instant just after local midnight', async () => {
    renderPage(BASE);
    const link = within(await line()).getByRole('link');
    expect(link.textContent).toContain('15 Mar 2027');
    expect(link.textContent).not.toContain('14 Mar');
  });

  it('HMS-15 REQ-11: only the date and time link to the appointment detail page', async () => {
    renderPage(BASE);
    const links = within(await line()).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('/appointments/7');
    expect(links[0]!.textContent).not.toContain('Test Doctor 001');
  });

  it('HMS-15 REQ-5: shows "No upcoming appointment", without a link, when next_appointment is null', async () => {
    renderPage({ ...BASE, next_appointment: null, appointments: [appt(5, '2026-10-01T04:30:00Z', 'CANCELLED')] });
    const p = await line();
    expect(p.textContent).toBe('No upcoming appointment');
    expect(within(p).queryByRole('link')).toBeNull();
    expect(screen.queryByText(/Next appointment:/)).toBeNull();
  });

  it('HMS-15 REQ-5: a patient with no appointments at all shows "No upcoming appointment" and the table empty text', async () => {
    renderPage({ ...BASE, next_appointment: null, appointments: [] });
    expect((await line()).textContent).toBe('No upcoming appointment');
    expect(screen.getByText('No appointments.')).toBeTruthy();
  });

  it('HMS-15 REQ-8: with an upcoming appointment, the Book appointment button and every table row stay', async () => {
    renderPage(BASE);
    await line();
    expect(screen.getByRole('link', { name: 'Book appointment' }).getAttribute('href')).toBe('/appointments/new?patientId=1');
    expect(screen.getByText('A-000007')).toBeTruthy();
    expect(screen.getByText('A-000005')).toBeTruthy();
  });

  it('HMS-15 REQ-8: without an upcoming appointment, the Book appointment button and the table rows stay', async () => {
    renderPage({ ...BASE, next_appointment: null, appointments: [appt(5, '2026-10-01T04:30:00Z', 'CANCELLED')] });
    await line();
    expect(screen.getByRole('link', { name: 'Book appointment' })).toBeTruthy();
    expect(screen.getByText('A-000005')).toBeTruthy();
  });
});
