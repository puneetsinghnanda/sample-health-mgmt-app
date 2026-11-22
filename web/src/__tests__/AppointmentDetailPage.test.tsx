import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AppointmentDetail } from '../api/types';
import { AppointmentDetailPage } from '../pages/AppointmentDetailPage';

const APPOINTMENT: AppointmentDetail = {
  id: 1, code: 'A-000001',
  doctor: {
    id: 1, code: 'D-0001', fullName: 'Test Doctor 001',
    specialization: { id: 1, name: 'Test Specialization 001', status: 'ACTIVE' },
    department: { id: 1, name: 'Test Department 001', status: 'ACTIVE' },
    feePaise: 50000,
  },
  patient: { id: 1, code: 'P-000001', fullName: 'Test Patient 001' },
  startsAt: '2026-10-20T04:30:00.000Z', endsAt: '2026-10-20T04:45:00.000Z',
  status: 'SCHEDULED', reason: 'Test reason 001', cancellationReason: null,
  history: [{ event: 'BOOKED', fromStartsAt: null, toStartsAt: '2026-10-20T04:30:00.000Z', note: null, actor: 'staff', at: '2026-10-19T02:30:00.000Z' }],
};

function renderPage(appointment: AppointmentDetail) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(appointment), { status: 200 })));
  render(
    <MemoryRouter initialEntries={[`/appointments/${appointment.id}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/appointments/:id" element={<AppointmentDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The <dd> right after the <dt> with this label. */
async function value(label: string): Promise<HTMLElement> {
  const term = await screen.findByText(label, { selector: 'dt' });
  return term.nextElementSibling as HTMLElement;
}

/** The labels of the details list, in order. */
async function labels(): Promise<string[]> {
  const term = await screen.findByText('Doctor', { selector: 'dt' });
  return Array.from(term.closest('dl')!.querySelectorAll('dt')).map((dt) => dt.textContent ?? '');
}

describe('AppointmentDetailPage doctor details (HMS-31)', () => {
  it('HMS-31 REQ-1/REQ-2/REQ-3: Specialization, Department and Consultation fee follow Doctor', async () => {
    renderPage(APPOINTMENT);
    expect(await labels()).toEqual(['When', 'Doctor', 'Specialization', 'Department', 'Consultation fee', 'Patient', 'Reason for visit']);
    expect((await value('Specialization')).textContent).toBe('Test Specialization 001');
    expect((await value('Department')).textContent).toBe('Test Department 001');
    expect((await value('Consultation fee')).textContent).toBe('₹500.00');
  });

  it('HMS-31 REQ-4 edge: a fee with paise shows ₹ and two decimals, as on the doctors list', async () => {
    renderPage({ ...APPOINTMENT, doctor: { ...APPOINTMENT.doctor, feePaise: 12345 } });
    expect((await value('Consultation fee')).textContent).toBe('₹123.45');
  });

  it('HMS-31 REQ-7: an Inactive specialization shows "(Inactive)"; the active department does not', async () => {
    renderPage({
      ...APPOINTMENT,
      doctor: { ...APPOINTMENT.doctor, specialization: { ...APPOINTMENT.doctor.specialization, status: 'INACTIVE' } },
    });
    expect((await value('Specialization')).textContent).toBe('Test Specialization 001 (Inactive)');
    expect((await value('Department')).textContent).toBe('Test Department 001');
  });

  it('HMS-31 REQ-7: an Inactive department shows "(Inactive)"; the active specialization does not', async () => {
    renderPage({
      ...APPOINTMENT,
      doctor: { ...APPOINTMENT.doctor, department: { ...APPOINTMENT.doctor.department, status: 'INACTIVE' } },
    });
    expect((await value('Department')).textContent).toBe('Test Department 001 (Inactive)');
    expect((await value('Specialization')).textContent).toBe('Test Specialization 001');
  });

  it('HMS-31 REQ-8: the doctor name still links to the doctor page', async () => {
    renderPage(APPOINTMENT);
    const link = (await value('Doctor')).querySelector('a');
    expect(link?.textContent).toBe('Test Doctor 001');
    expect(link?.getAttribute('href')).toBe('/doctors/1');
  });

  it('HMS-31 REQ-11: a Scheduled appointment keeps its actions and history', async () => {
    renderPage(APPOINTMENT);
    await value('Specialization');
    for (const name of ['Reschedule', 'Cancel appointment', 'Mark completed', 'Mark no-show']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.getByRole('heading', { name: 'History' })).toBeTruthy();
    expect(screen.getByText('Booked')).toBeTruthy();
  });

  it('HMS-31 REQ-11: a Cancelled appointment keeps its cancellation reason and closed notice, with the new rows', async () => {
    renderPage({ ...APPOINTMENT, status: 'CANCELLED', cancellationReason: 'Test cancellation 001' });
    expect((await value('Cancellation reason')).textContent).toBe('Test cancellation 001');
    expect((await value('Consultation fee')).textContent).toBe('₹500.00');
    expect(screen.getByText('This appointment is closed and can no longer be changed.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reschedule' })).toBeNull();
  });

  for (const [status, event, label] of [
    ['COMPLETED', 'COMPLETED', 'Marked completed'],
    ['NO_SHOW', 'NO_SHOW', 'Marked no-show'],
  ] as const) {
    it(`HMS-31 REQ-11: a ${status} appointment keeps its rows, closed notice and history, with the new rows`, async () => {
      renderPage({
        ...APPOINTMENT,
        status,
        history: [...APPOINTMENT.history, { event, fromStartsAt: null, toStartsAt: null, note: null, actor: 'staff', at: '2026-10-20T04:40:00.000Z' }],
      });
      expect(await labels()).toEqual(['When', 'Doctor', 'Specialization', 'Department', 'Consultation fee', 'Patient', 'Reason for visit']);
      expect((await value('Patient')).textContent).toBe('Test Patient 001');
      expect((await value('Reason for visit')).textContent).toBe('Test reason 001');
      expect(screen.getByText('This appointment is closed and can no longer be changed.')).toBeTruthy();
      for (const name of ['Reschedule', 'Cancel appointment', 'Mark completed', 'Mark no-show']) {
        expect(screen.queryByRole('button', { name })).toBeNull();
      }
      expect(screen.getByText('Booked')).toBeTruthy();
      expect(screen.getByText(label)).toBeTruthy();
    });
  }
});
