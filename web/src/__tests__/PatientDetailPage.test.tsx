import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AppointmentSummary, PatientDetail } from '../api/types';
import { PatientDetailPage } from '../pages/PatientDetailPage';

const APPOINTMENT: AppointmentSummary = {
  id: 42, code: 'A-000042',
  doctor: { id: 1, code: 'D-0001', fullName: 'Test Doctor 001' },
  patient: { id: 1, code: 'P-000001', fullName: 'Test Patient 001' },
  startsAt: '2026-11-05T05:00:00.000Z', endsAt: '2026-11-05T05:15:00.000Z', status: 'COMPLETED',
};

const PATIENT: PatientDetail = {
  id: 1, code: 'P-000001', fullName: 'Test Patient 001', dateOfBirth: '1990-05-01', age: 36, gender: 'FEMALE',
  phone: '+91 00000 00000', status: 'ACTIVE', registeredAt: '2026-10-01T00:00:00.000Z',
  email: 'patient001@example.com', address: null, emergencyContact: { name: null, phone: null },
  medicalHistory: { bloodGroup: 'O+', allergies: ['Test Allergy 001'], chronicConditions: [], currentMedications: [], notes: null },
  appointments: [APPOINTMENT],
  visitSummary: {
    completed: 1, noShow: 0, cancelled: 0, upcoming: 0,
    lastVisit: { appointmentId: 42, date: '2026-11-05', doctorName: 'Test Doctor 001' },
  },
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

describe('PatientDetailPage visit summary (HMS-24)', () => {
  it('HMS-24 REQ-1: the Visit summary sits directly above the Appointments table, under its heading', async () => {
    renderPage(PATIENT);
    const summary = await screen.findByLabelText('Visit summary');
    expect(summary.previousElementSibling?.tagName).toBe('H2');
    expect(summary.previousElementSibling?.textContent).toBe('Appointments');
    expect(summary.nextElementSibling?.tagName).toBe('TABLE');
    expect(within(summary).getByText('1 completed · 0 no-show · 0 cancelled · 0 upcoming')).toBeTruthy();
    expect(within(summary).getByRole('link').getAttribute('href')).toBe('/appointments/42');
  });

  it('HMS-24 REQ-12: a patient with no appointments shows "No visits yet" and the table keeps its empty state', async () => {
    renderPage({
      ...PATIENT, appointments: [],
      visitSummary: { completed: 0, noShow: 0, cancelled: 0, upcoming: 0, lastVisit: null },
    });
    const summary = await screen.findByLabelText('Visit summary');
    expect(summary.textContent).toBe('No visits yet');
    expect(screen.getByText('No appointments.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('HMS-24 REQ-12 edge: an unclosed past Scheduled appointment still shows the zero counts, not "No visits yet"', async () => {
    renderPage({
      ...PATIENT,
      appointments: [{ ...APPOINTMENT, status: 'SCHEDULED' }],
      visitSummary: { completed: 0, noShow: 0, cancelled: 0, upcoming: 0, lastVisit: null },
    });
    const summary = await screen.findByLabelText('Visit summary');
    expect(within(summary).getByText('0 completed · 0 no-show · 0 cancelled · 0 upcoming')).toBeTruthy();
    expect(within(summary).getByText('Last visit: none yet')).toBeTruthy();
  });

  it('HMS-24 REQ-13, REQ-14: medical history stays in its own section and out of the summary', async () => {
    renderPage(PATIENT);
    const summary = await screen.findByLabelText('Visit summary');
    expect(summary.textContent).not.toMatch(/Test Allergy 001|O\+/);
    const history = screen.getByLabelText('Medical history');
    expect(within(history).getByText('Test Allergy 001')).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });
});
