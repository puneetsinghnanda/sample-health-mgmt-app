import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AppointmentDetail } from '../api/types';
import { AppointmentDetailPage } from '../pages/AppointmentDetailPage';

const OUTSIDE = "This appointment is outside the doctor's current availability. Reschedule or cancel it.";
const INACTIVE = 'The doctor is Inactive. Cancel this appointment or book the patient with another doctor.';

const APPT: AppointmentDetail = {
  id: 1, code: 'A-000001',
  doctor: { id: 1, code: 'D-0001', fullName: 'Test Doctor 001' },
  patient: { id: 1, code: 'P-000001', fullName: 'Test Patient 001' },
  startsAt: '2026-10-20T05:30:00.000Z', endsAt: '2026-10-20T05:45:00.000Z', status: 'SCHEDULED',
  reason: 'Test reason 001', cancellationReason: null, history: [],
  doctorStatus: 'ACTIVE', outsideAvailability: false,
};

function renderPage(appt: AppointmentDetail) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(appt), { status: 200 })));
  render(
    <MemoryRouter initialEntries={[`/appointments/${appt.id}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/appointments/:id" element={<AppointmentDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Waits for the page to load, then returns the notice texts in document order. */
async function notices(): Promise<string[]> {
  await screen.findByRole('heading', { name: 'History' });
  return screen.queryAllByRole('status').map((n) => n.textContent ?? '');
}

describe('AppointmentDetailPage notices (HMS-13)', () => {
  it('HMS-13 REQ-1: a Scheduled appointment outside the availability shows the notice above the actions', async () => {
    renderPage({ ...APPT, outsideAvailability: true });
    expect(await notices()).toEqual([OUTSIDE]);
    const notice = screen.getByText(OUTSIDE);
    const reschedule = screen.getByRole('button', { name: 'Reschedule' });
    expect(notice.compareDocumentPosition(reschedule) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('HMS-13 REQ-5: a Scheduled appointment of an Inactive doctor shows the Inactive notice above the actions', async () => {
    renderPage({ ...APPT, doctorStatus: 'INACTIVE' });
    expect(await notices()).toEqual([INACTIVE]);
    const reschedule = screen.getByRole('button', { name: 'Reschedule' });
    expect(screen.getByText(INACTIVE).compareDocumentPosition(reschedule) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('HMS-13 REQ-6 REQ-7: when both apply, both show, the availability notice first', async () => {
    renderPage({ ...APPT, doctorStatus: 'INACTIVE', outsideAvailability: true });
    expect(await notices()).toEqual([OUTSIDE, INACTIVE]);
  });

  it('HMS-13 REQ-2 edge: an Active doctor and an appointment inside the availability show no notice', async () => {
    renderPage(APPT);
    expect(await notices()).toEqual([]);
  });

  for (const status of ['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const) {
    it(`HMS-13 REQ-8: a ${status} appointment shows neither notice, even with an Inactive doctor and a stray flag`, async () => {
      renderPage({
        ...APPT, status, doctorStatus: 'INACTIVE', outsideAvailability: true,
        cancellationReason: status === 'CANCELLED' ? 'Test cancellation 001' : null,
      });
      expect(await notices()).toEqual([]);
      expect(screen.getByText('This appointment is closed and can no longer be changed.')).toBeTruthy();
    });
  }

  it('HMS-13 REQ-9: with notices shown, the details, actions and history are still there', async () => {
    renderPage({ ...APPT, doctorStatus: 'INACTIVE', outsideAvailability: true });
    await notices();
    for (const term of ['When', 'Doctor', 'Patient', 'Reason for visit']) expect(screen.getByText(term).tagName).toBe('DT');
    for (const name of ['Reschedule', 'Cancel appointment', 'Mark completed', 'Mark no-show']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.getByText('Test Doctor 001')).toBeTruthy();
    expect(screen.getByText('Test reason 001')).toBeTruthy();
  });
});
