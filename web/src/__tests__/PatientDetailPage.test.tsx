import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PatientDetail } from '../api/types';
import { PatientDetailPage } from '../pages/PatientDetailPage';

const PATIENT: PatientDetail = {
  id: 1, code: 'P-000001', fullName: 'Test Patient 001', dateOfBirth: '1990-01-01', age: 36, gender: 'OTHER',
  phone: '+91 00000 00000', status: 'ACTIVE', registeredAt: '2026-10-01T04:30:00Z', email: 'user@example.com',
  address: null, emergencyContact: { name: null, phone: null },
  medicalHistory: { bloodGroup: 'O+', allergies: ['Test Allergy'], chronicConditions: [], currentMedications: [], notes: null },
  appointments: [],
  visit_summary: { completed: 3, no_show: 2 },
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

function valueOf(summary: HTMLElement, term: string): string | null {
  const dt = Array.from(summary.querySelectorAll('dt')).find((d) => d.textContent === term);
  return dt?.nextElementSibling?.textContent ?? null;
}

describe('PatientDetailPage visit summary (HMS-5)', () => {
  it('HMS-5 REQ-1: shows a Visit summary above the appointments list', async () => {
    renderPage(PATIENT);
    const summary = await screen.findByRole('heading', { name: 'Visit summary' });
    const appointments = screen.getByRole('heading', { name: 'Appointments' });
    expect(summary.compareDocumentPosition(appointments) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('HMS-5 REQ-2/REQ-3: shows the Completed and No-show counts', async () => {
    renderPage(PATIENT);
    const summary = await screen.findByLabelText('Visit summary');
    expect(valueOf(summary, 'Completed')).toBe('3');
    expect(valueOf(summary, 'No-show')).toBe('2');
  });

  it('HMS-5 REQ-6 edge: shows 0 for each count when there are none', async () => {
    renderPage({ ...PATIENT, visit_summary: { completed: 0, no_show: 0 } });
    const summary = await screen.findByLabelText('Visit summary');
    expect(valueOf(summary, 'Completed')).toBe('0');
    expect(valueOf(summary, 'No-show')).toBe('0');
  });

  it('HMS-5 REQ-6 edge: shows 0 Completed next to a non-zero No-show count', async () => {
    renderPage({ ...PATIENT, visit_summary: { completed: 0, no_show: 1 } });
    const summary = await screen.findByLabelText('Visit summary');
    expect(valueOf(summary, 'Completed')).toBe('0');
    expect(valueOf(summary, 'No-show')).toBe('1');
  });

  it('HMS-5 REQ-8: the medical history is still shown', async () => {
    renderPage(PATIENT);
    const history = await screen.findByLabelText('Medical history');
    expect(history.textContent).toContain('Test Allergy');
  });
});
