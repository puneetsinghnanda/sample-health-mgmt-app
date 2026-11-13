import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AppointmentSummary, PatientDetail } from '../api/types';
import { PatientDetailPage } from '../pages/PatientDetailPage';

const APPOINTMENT: AppointmentSummary = {
  id: 1, code: 'A-000001',
  doctor: { id: 1, code: 'D-0001', fullName: 'Test Doctor 001' },
  patient: { id: 1, code: 'P-000001', fullName: 'Test Patient 001' },
  startsAt: '2026-10-20T04:30:00Z', endsAt: '2026-10-20T04:45:00Z', status: 'SCHEDULED',
};

const PAST: AppointmentSummary = {
  ...APPOINTMENT, id: 2, code: 'A-000002',
  startsAt: '2026-10-12T04:30:00Z', endsAt: '2026-10-12T04:45:00Z', status: 'COMPLETED',
};
const OLDER: AppointmentSummary = {
  ...APPOINTMENT, id: 3, code: 'A-000003',
  startsAt: '2026-10-05T04:30:00Z', endsAt: '2026-10-05T04:45:00Z', status: 'NO_SHOW',
};

/** The codes of the appointment rows, in the order the table shows them. */
async function appointmentCodes(): Promise<string[]> {
  const heading = await screen.findByRole('heading', { name: 'Appointments' });
  const table = heading.nextElementSibling as HTMLElement;
  return within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('link')[0]!.textContent ?? '');
}

const PATIENT: PatientDetail = {
  id: 1, code: 'P-000001', fullName: 'Test Patient 001', dateOfBirth: '1990-05-01', age: 36,
  gender: 'FEMALE', phone: '+91 00000 00000', status: 'ACTIVE', registeredAt: '2026-10-01T00:00:00Z',
  email: null, address: null, emergencyContact: { name: null, phone: null },
  medicalHistory: { bloodGroup: 'O+', allergies: ['Test Allergy 001'], chronicConditions: [], currentMedications: [], notes: null },
  visitSummary: { completed: 2, noShow: 1 },
  appointments: [APPOINTMENT],
};

function renderPage(patient: PatientDetail) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(patient), { status: 200 })));
  render(
    <MemoryRouter initialEntries={[`/patients/${patient.id}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/patients/:id" element={<PatientDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function summaryValue(term: string): Promise<string | null> {
  const list = await screen.findByLabelText('Visit summary');
  return within(list).getByText(term).nextElementSibling?.textContent ?? null;
}

describe('PatientDetailPage Visit summary (HMS-5)', () => {
  it('HMS-5 REQ-1: shows a Visit summary heading above the Appointments heading', async () => {
    renderPage(PATIENT);
    const summary = await screen.findByRole('heading', { name: 'Visit summary' });
    const appointments = screen.getByRole('heading', { name: 'Appointments' });
    expect(summary.compareDocumentPosition(appointments) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('HMS-5 REQ-2/REQ-3: shows the Completed and No-show counts', async () => {
    renderPage(PATIENT);
    expect(await summaryValue('Completed')).toBe('2');
    expect(await summaryValue('No-show')).toBe('1');
  });

  it('HMS-5 REQ-5: a patient with neither shows 0 for each', async () => {
    renderPage({ ...PATIENT, visitSummary: { completed: 0, noShow: 0 }, appointments: [] });
    expect(await summaryValue('Completed')).toBe('0');
    expect(await summaryValue('No-show')).toBe('0');
  });

  it('HMS-5 REQ-7/REQ-9: the appointments list and the other sections are still shown', async () => {
    renderPage(PATIENT);
    await screen.findByRole('heading', { name: 'Visit summary' });
    expect(screen.getByRole('heading', { name: 'Medical history' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'A-000001' })).toBeTruthy();
  });

  it('HMS-5 REQ-7 (S-3 AC1): upcoming then past appointments keep their order, upcoming first', async () => {
    renderPage({ ...PATIENT, appointments: [APPOINTMENT, PAST] });
    expect(await appointmentCodes()).toEqual(['A-000001', 'A-000002']);
  });

  it('HMS-5 REQ-7 (S-3 AC2): a patient with only past appointments keeps the same rows in the same order', async () => {
    renderPage({ ...PATIENT, appointments: [PAST, OLDER] });
    expect(await appointmentCodes()).toEqual(['A-000002', 'A-000003']);
  });

  it('HMS-5 REQ-6 (S-1 AC4): the Visit summary offers no period picker', async () => {
    renderPage(PATIENT);
    const list = await screen.findByLabelText('Visit summary');
    expect(within(list).queryByRole('combobox')).toBeNull();
    expect(within(list).queryByRole('button')).toBeNull();
    expect(screen.queryByText(/Last 30 days|Last 7 days/)).toBeNull();
  });

  it('HMS-5 REQ-7 edge: a patient without appointments still shows the empty list text', async () => {
    renderPage({ ...PATIENT, visitSummary: { completed: 0, noShow: 0 }, appointments: [] });
    await screen.findByRole('heading', { name: 'Visit summary' });
    expect(screen.getByText('No appointments.')).toBeTruthy();
  });

  it('HMS-5 REQ-8: medical history with entries is shown as before', async () => {
    renderPage(PATIENT);
    const history = await screen.findByLabelText('Medical history');
    expect(within(history).getByText('Test Allergy 001')).toBeTruthy();
  });

  it('HMS-5 REQ-8 edge: a patient with no medical history still shows "None recorded"', async () => {
    renderPage({ ...PATIENT, medicalHistory: { bloodGroup: null, allergies: [], chronicConditions: [], currentMedications: [], notes: null } });
    const history = await screen.findByLabelText('Medical history');
    expect(within(history).getAllByText('None recorded')).toHaveLength(3);
    expect(within(history).getByText('Not recorded')).toBeTruthy();
  });
});
