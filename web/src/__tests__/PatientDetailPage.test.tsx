import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PatientDetail, PatientVisits, Settings } from '../api/types';
import { SettingsProvider } from '../hooks/useSettings';
import { PatientDetailPage } from '../pages/PatientDetailPage';

const NONE: PatientVisits = { next: null, last: null, completed: 0, cancelled: 0, no_show: 0 };

const PATIENT: PatientDetail = {
  id: 1, code: 'P-000001', fullName: 'Test Patient 001', dateOfBirth: '1990-01-01', age: 36, gender: 'OTHER',
  phone: '+91 00000 00001', status: 'ACTIVE', registeredAt: '2026-10-01T04:30:00Z',
  email: 'patient001@example.com', address: null, emergencyContact: { name: null, phone: null },
  medicalHistory: { bloodGroup: 'O+', allergies: ['Test Allergy 001'], chronicConditions: [], currentMedications: ['Test Medicine 001'], notes: null },
  appointments: [],
  visits: NONE,
};

/** 19:00 UTC on 9 March is 00:30 on 10 March in Kolkata (UTC+05:30); 20:00 UTC is 01:30 local. */
const VISITS: PatientVisits = {
  next: { id: 42, starts_at: '2026-03-09T19:00:00.000Z', doctor_name: 'Test Doctor 001' },
  last: { id: 17, starts_at: '2026-03-09T20:00:00.000Z', doctor_name: 'Test Doctor 002' },
  completed: 2, cancelled: 1, no_show: 1,
};

function renderPage(visits: PatientVisits, settings?: Settings) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...PATIENT, visits }), { status: 200 })));
  render(
    <SettingsProvider value={settings}>
      <MemoryRouter initialEntries={['/patients/1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/patients/:id" element={<PatientDetailPage />} />
        </Routes>
      </MemoryRouter>
    </SettingsProvider>,
  );
}

async function summary(): Promise<HTMLElement> {
  return screen.findByRole('region', { name: 'Visits' });
}

/** The <dd> after the <dt> with this label, inside the summary. */
function value(region: HTMLElement, label: string): HTMLElement {
  return within(region).getByText(label).nextElementSibling as HTMLElement;
}

describe('PatientDetailPage visits summary (HMS-26)', () => {
  it('HMS-26 REQ-1: the summary sits below the name and above the details', async () => {
    renderPage(VISITS);
    const region = await summary();
    const name = screen.getByRole('heading', { level: 1 });
    const details = screen.getByText('Date of birth');
    expect(name.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('HMS-26 REQ-4, REQ-5, REQ-9: next shows local date and time and the doctor, linked to the appointment', async () => {
    renderPage(VISITS);
    const next = value(await summary(), 'Next appointment');
    const link = within(next).getByRole('link');
    expect(link.getAttribute('href')).toBe('/appointments/42');
    expect(link.textContent).toMatch(/10 Mar 2026.*00:30/);
    expect(next.textContent).toContain('Test Doctor 001');
  });

  it('HMS-26 REQ-8, REQ-9: last visit shows the local date only and the doctor', async () => {
    renderPage(VISITS);
    const last = value(await summary(), 'Last visit');
    expect(last.textContent).toMatch(/10 Mar 2026/);
    expect(last.textContent).not.toMatch(/01:30|20:00/);
    expect(last.textContent).toContain('Test Doctor 002');
  });

  it('HMS-26 REQ-9 (S-6): dates follow the settings zone, not a hard-coded Asia/Kolkata', async () => {
    renderPage(VISITS, { timeZone: 'UTC', currency: 'INR', pageSize: 20 });
    const region = await summary();
    expect(value(region, 'Next appointment').textContent).toMatch(/09 Mar 2026.*19:00/);
    expect(value(region, 'Last visit').textContent).toMatch(/09 Mar 2026/);
    expect(value(region, 'Last visit').textContent).not.toMatch(/10 Mar/);
  });

  it('HMS-26 REQ-6, REQ-10, REQ-12, REQ-14: a patient with no appointments shows None booked, No visits yet and three 0s', async () => {
    renderPage(NONE);
    const region = await summary();
    expect(value(region, 'Next appointment').textContent).toBe('None booked');
    expect(within(value(region, 'Next appointment')).queryByRole('link')).toBeNull();
    expect(value(region, 'Last visit').textContent).toBe('No visits yet');
    expect(['Completed', 'Cancelled', 'No-show'].map((l) => value(region, l).textContent)).toEqual(['0', '0', '0']);
  });

  it('HMS-26 REQ-2, REQ-13 edge: one No-show is shown plainly, not as a warning', async () => {
    renderPage(VISITS);
    const region = await summary();
    expect(['Completed', 'Cancelled', 'No-show'].map((l) => value(region, l).textContent)).toEqual(['2', '1', '1']);
    expect(value(region, 'No-show').querySelector('.badge-warning')).toBeNull();
  });

  it('HMS-26 REQ-13: two No-shows are highlighted as a warning', async () => {
    renderPage({ ...VISITS, no_show: 2 });
    const noShow = value(await summary(), 'No-show');
    expect(noShow.querySelector('.badge-warning')?.textContent).toBe('2');
  });

  it('HMS-26 REQ-15, REQ-16: the summary shows no medical history and no contact details', async () => {
    renderPage(VISITS);
    const text = (await summary()).textContent ?? '';
    for (const hidden of ['Test Allergy 001', 'Test Medicine 001', '+91 00000 00001', 'patient001@example.com']) {
      expect(text).not.toContain(hidden);
    }
  });

  it('HMS-26 REQ-18: the details, medical history and appointments sections are still shown', async () => {
    renderPage(VISITS);
    await summary();
    expect(screen.getByText('+91 00000 00001')).toBeTruthy();
    expect(screen.getByLabelText('Medical history')).toBeTruthy();
    expect(screen.getByText('Test Allergy 001')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Appointments' })).toBeTruthy();
  });
});
