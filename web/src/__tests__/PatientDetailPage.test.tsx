import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AppointmentSummary, PatientDetail } from '../api/types';
import { PatientDetailPage } from '../pages/PatientDetailPage';

const appointment = (id: number, startsAt: string, status: AppointmentSummary['status']): AppointmentSummary => ({
  id, code: `A-00000${id}`,
  doctor: { id: 1, code: 'D-0001', fullName: 'Test Doctor 001' },
  patient: { id: 1, code: 'P-000001', fullName: 'Test Patient 001' },
  startsAt, endsAt: startsAt, status,
});

const PATIENT: PatientDetail = {
  id: 1, code: 'P-000001', fullName: 'Test Patient 001', dateOfBirth: '1990-05-01', age: 36, gender: 'FEMALE',
  phone: '+91 00000 00000', status: 'ACTIVE', registeredAt: '2026-10-01T04:30:00.000Z',
  email: 'user@example.com', address: 'Invented Street 1', emergencyContact: { name: 'Test Contact 001', phone: null },
  medicalHistory: {
    bloodGroup: 'O+', allergies: ['Test Allergy 001'], chronicConditions: ['Test Condition 001'],
    currentMedications: ['Test Medication 001'], notes: 'Invented note',
  },
  visitSummary: { completed: 2, noShow: 1 },
  appointments: [
    appointment(4, '2026-10-20T04:30:00.000Z', 'SCHEDULED'),
    appointment(3, '2026-10-19T04:00:00.000Z', 'NO_SHOW'),
    appointment(2, '2026-10-19T03:45:00.000Z', 'COMPLETED'),
    appointment(1, '2026-10-19T03:30:00.000Z', 'CANCELLED'),
  ],
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

async function summary(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: 'Visit summary' });
  return heading.nextElementSibling as HTMLElement;
}

const value = (list: HTMLElement, term: string): string | null =>
  (within(list).getByText(term).nextElementSibling as HTMLElement).textContent;

const rowCodes = (): Array<string | null> =>
  within(screen.getByRole('table')).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0]!.textContent);

describe('PatientDetailPage Visit summary (HMS-5)', () => {
  it('HMS-5 REQ-1: shows a "Visit summary" directly above the appointments list (S-1 AC1)', async () => {
    renderPage(PATIENT);
    const list = await summary();
    const names = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(names).toEqual(['Medical history', 'Visit summary', 'Appointments']);
    expect(list.tagName).toBe('DL');
    expect((list.nextElementSibling as HTMLElement).textContent).toBe('Appointments');
  });

  it('HMS-5 REQ-2/REQ-3: shows the Completed and the No-show count, not swapped (S-1 AC1)', async () => {
    renderPage(PATIENT);
    const list = await summary();
    expect(value(list, 'Completed')).toBe('2');
    expect(value(list, 'No-show')).toBe('1');
  });

  it('HMS-5 REQ-3 edge: No-shows only, the counts are not merged (S-1 AC2)', async () => {
    renderPage({ ...PATIENT, visitSummary: { completed: 0, noShow: 3 } });
    const list = await summary();
    expect(value(list, 'Completed')).toBe('0');
    expect(value(list, 'No-show')).toBe('3');
  });

  it('HMS-5 REQ-5: a patient with neither shows 0 for each (S-2 AC2, AC3)', async () => {
    renderPage({ ...PATIENT, visitSummary: { completed: 0, noShow: 0 }, appointments: [] });
    const list = await summary();
    expect(value(list, 'Completed')).toBe('0');
    expect(value(list, 'No-show')).toBe('0');
  });

  it('HMS-5 REQ-4: the page shows the counts the API sends, not a count of the listed rows (S-2 AC1)', async () => {
    renderPage({ ...PATIENT, visitSummary: { completed: 7, noShow: 5 } });
    const list = await summary();
    expect(value(list, 'Completed')).toBe('7');
    expect(value(list, 'No-show')).toBe('5');
  });

  it('HMS-5 REQ-6: the Visit summary offers no period picker (S-1 AC4)', async () => {
    renderPage(PATIENT);
    const list = await summary();
    expect(within(list).queryByRole('combobox')).toBeNull();
    expect(within(list).queryByRole('button')).toBeNull();
    expect(within(list).queryByRole('link')).toBeNull();
    expect(screen.queryByText(/Today|Last 7 days|Last 30 days/)).toBeNull();
  });

  it('HMS-5 REQ-7: upcoming and past appointments of every status keep the order given (S-3 AC1)', async () => {
    renderPage(PATIENT);
    await summary();
    expect(rowCodes()).toEqual(['A-000004', 'A-000003', 'A-000002', 'A-000001']);
  });

  it('HMS-5 REQ-7: a patient with only past appointments shows the same rows in the same order (S-3 AC2)', async () => {
    renderPage({ ...PATIENT, appointments: PATIENT.appointments.slice(1) });
    await summary();
    expect(rowCodes()).toEqual(['A-000003', 'A-000002', 'A-000001']);
  });

  it('HMS-5 REQ-7 edge: a patient with no appointments still shows "No appointments."', async () => {
    renderPage({ ...PATIENT, visitSummary: { completed: 0, noShow: 0 }, appointments: [] });
    await summary();
    expect(screen.getByText('No appointments.')).toBeTruthy();
  });

  it('HMS-5 REQ-8: medical history with entries is shown as before (S-3 AC3)', async () => {
    renderPage(PATIENT);
    await summary();
    const history = screen.getByLabelText('Medical history');
    expect(value(history, 'Blood group')).toBe('O+');
    expect(value(history, 'Allergies')).toBe('Test Allergy 001');
    expect(value(history, 'Chronic conditions')).toBe('Test Condition 001');
    expect(value(history, 'Current medications')).toBe('Test Medication 001');
    expect(value(history, 'Notes')).toBe('Invented note');
  });

  it('HMS-5 REQ-8 edge: without medical history the same placeholders are shown (S-3 AC5)', async () => {
    renderPage({
      ...PATIENT,
      medicalHistory: { bloodGroup: null, allergies: [], chronicConditions: [], currentMedications: [], notes: null },
    });
    await summary();
    const history = screen.getByLabelText('Medical history');
    expect(value(history, 'Blood group')).toBe('Not recorded');
    expect(value(history, 'Allergies')).toBe('None recorded');
    expect(value(history, 'Notes')).toBe('—');
  });

  it('HMS-5 REQ-9: the patient details and actions are still shown (S-3 AC4)', async () => {
    renderPage(PATIENT);
    await summary();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Test Patient 001');
    expect(screen.getByText('Date of birth').nextElementSibling?.textContent).toBe('1990-05-01 (36 years)');
    expect(screen.getByText('Phone').nextElementSibling?.textContent).toBe('+91 00000 00000');
    expect(screen.getByRole('link', { name: 'Book appointment' }).getAttribute('href')).toBe('/appointments/new?patientId=1');
    expect(screen.getByRole('link', { name: 'Edit' }).getAttribute('href')).toBe('/patients/1/edit');
  });

  it('HMS-5 REQ-9 error: a patient that cannot be loaded shows the error, and no Visit summary', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Patient P-009999 not found' } }), { status: 404 },
    )));
    render(
      <MemoryRouter initialEntries={['/patients/9999']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/patients/:id" element={<PatientDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/not found/i)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Visit summary' })).toBeNull();
  });
});
