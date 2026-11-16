import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppointmentDetail } from '../api/types';
import { AppointmentDetailPage } from '../pages/AppointmentDetailPage';

const CANCELLED: AppointmentDetail = {
  id: 7, code: 'A-000007',
  doctor: { id: 1, code: 'D-0001', fullName: 'Test Doctor 001' },
  patient: { id: 2, code: 'P-000002', fullName: 'Test Patient 002' },
  startsAt: '2026-10-19T03:30:00Z', endsAt: '2026-10-19T03:45:00Z',
  status: 'CANCELLED', reason: 'Follow-up', cancellationReason: 'Doctor on leave',
  doctor_status: 'ACTIVE', patient_status: 'ACTIVE', history: [],
};

/** Shows where Book again navigated to, and what it put in navigation state. */
function BookProbe() {
  const location = useLocation();
  return (
    <div>
      <p data-testid="search">{location.search}</p>
      <p data-testid="state">{JSON.stringify(location.state ?? null)}</p>
    </div>
  );
}

function renderPage(appt: AppointmentDetail) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(appt), { status: 200 })));
  render(
    <MemoryRouter initialEntries={[`/appointments/${appt.id}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/appointments/new" element={<BookProbe />} />
        <Route path="/appointments/:id" element={<AppointmentDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('AppointmentDetailPage Book again (HMS-14)', () => {
  it('HMS-14 REQ-1 (S-1 AC1): a Cancelled appointment shows an enabled Book again button', async () => {
    renderPage(CANCELLED);
    const button = await screen.findByRole('button', { name: 'Book again' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('HMS-14 REQ-2 (S-1 AC2): a No-show appointment shows Book again', async () => {
    renderPage({ ...CANCELLED, status: 'NO_SHOW', cancellationReason: null });
    expect(await screen.findByRole('button', { name: 'Book again' })).toBeTruthy();
  });

  it('HMS-14 REQ-3 (S-1 AC3): a Scheduled appointment has no Book again', async () => {
    renderPage({ ...CANCELLED, status: 'SCHEDULED', cancellationReason: null });
    await screen.findByRole('button', { name: 'Reschedule' });
    expect(screen.queryByRole('button', { name: 'Book again' })).toBeNull();
  });

  it('HMS-14 REQ-3 (S-1 AC4): a Completed appointment has no Book again', async () => {
    renderPage({ ...CANCELLED, status: 'COMPLETED', cancellationReason: null });
    await screen.findByText('This appointment is closed and can no longer be changed.');
    expect(screen.queryByRole('button', { name: 'Book again' })).toBeNull();
  });

  it('HMS-14 REQ-4/REQ-5/REQ-6/REQ-8/REQ-19 (S-2 AC1, S-3 AC2): opens booking with doctor and patient, the visit reason in state, no slot, no cancellation reason', async () => {
    renderPage(CANCELLED);
    fireEvent.click(await screen.findByRole('button', { name: 'Book again' }));
    expect((await screen.findByTestId('search')).textContent).toBe('?doctorId=1&patientId=2');
    const state = screen.getByTestId('state').textContent ?? '';
    expect(JSON.parse(state)).toEqual({ reason: 'Follow-up' });
    expect(state).not.toContain('Doctor on leave');
  });

  it('HMS-14 REQ-18 (S-3 AC3): an original without a reason passes no state', async () => {
    renderPage({ ...CANCELLED, reason: null });
    fireEvent.click(await screen.findByRole('button', { name: 'Book again' }));
    expect((await screen.findByTestId('state')).textContent).toBe('null');
  });

  it('HMS-14 REQ-9 (S-4 AC1): an Inactive doctor disables Book again with "Doctor is inactive"', async () => {
    renderPage({ ...CANCELLED, doctor_status: 'INACTIVE' });
    const button = await screen.findByRole('button', { name: 'Book again' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Doctor is inactive')).toBeTruthy();
    expect(screen.queryByText('Patient is inactive')).toBeNull();
  });

  it('HMS-14 REQ-10 (S-4 AC2): an Inactive patient disables Book again with "Patient is inactive"', async () => {
    renderPage({ ...CANCELLED, status: 'NO_SHOW', patient_status: 'INACTIVE' });
    const button = await screen.findByRole('button', { name: 'Book again' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Patient is inactive')).toBeTruthy();
    expect(screen.queryByText('Doctor is inactive')).toBeNull();
  });

  it('HMS-14 REQ-11 (S-4 AC3): both Inactive shows both reasons', async () => {
    renderPage({ ...CANCELLED, doctor_status: 'INACTIVE', patient_status: 'INACTIVE' });
    const button = await screen.findByRole('button', { name: 'Book again' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Doctor is inactive')).toBeTruthy();
    expect(screen.getByText('Patient is inactive')).toBeTruthy();
  });

  it('HMS-14 REQ-17 (S-6 AC1): a Scheduled appointment still offers reschedule, cancel, completed and no-show', async () => {
    renderPage({ ...CANCELLED, status: 'SCHEDULED', cancellationReason: null });
    for (const name of ['Reschedule', 'Cancel appointment', 'Mark completed', 'Mark no-show']) {
      expect(await screen.findByRole('button', { name })).toBeTruthy();
    }
  });
});
