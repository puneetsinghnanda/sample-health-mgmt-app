import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { DoctorDetail } from '../api/types';
import { DoctorDetailPage, noShowsQuery } from '../pages/DoctorDetailPage';

const WINDOW = { from: '2026-09-20', to: '2026-10-19' };

const DOCTOR: DoctorDetail = {
  id: 1, code: 'D-0001', fullName: 'Test Doctor 001',
  specialization: { id: 1, name: 'Test Specialization 001', status: 'ACTIVE' },
  department: { id: 1, name: 'Test Department 001', status: 'ACTIVE' },
  phone: '+91 00000 00000', email: null, feePaise: 50000, slotMinutes: 15, status: 'ACTIVE',
  availability: [], upcoming: [], outsideAvailability: [], appointmentCount: 4,
  noShowsLast30Days: 3, noShowsWindow: WINDOW,
};

function renderPage(doctor: DoctorDetail) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(
    JSON.stringify(url.includes('/slots') ?{ doctorId: doctor.id, date: WINDOW.to, slotMinutes: 15, slots: [], appointments: [] } : doctor),
    { status: 200 },
  )));
  render(
    <MemoryRouter initialEntries={[`/doctors/${doctor.id}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/doctors/:id" element={<DoctorDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function noShowsCell(): Promise<HTMLElement> {
  const term = await screen.findByText('No-shows (last 30 days)');
  return term.nextElementSibling as HTMLElement;
}

describe('DoctorDetailPage No-shows (HMS-7)', () => {
  it('HMS-7 REQ-1: shows "No-shows (last 30 days)" in the details list', async () => {
    renderPage(DOCTOR);
    const term = await screen.findByText('No-shows (last 30 days)');
    expect(term.tagName).toBe('DT');
    expect(term.closest('dl')?.classList.contains('details')).toBe(true);
  });

  it("HMS-7 REQ-6: the count links to the doctor's No-shows for the same window", async () => {
    renderPage(DOCTOR);
    const link = within(await noShowsCell()).getByRole('link');
    expect(link.textContent).toBe('3');
    expect(link.getAttribute('href')).toBe('/appointments?doctorId=1&status=NO_SHOW&from=2026-09-20&to=2026-10-19');
  });

  it('HMS-7 REQ-5/REQ-7: a doctor with none shows 0, still linked', async () => {
    renderPage({ ...DOCTOR, id: 2, code: 'D-0002', noShowsLast30Days: 0 });
    const link = within(await noShowsCell()).getByRole('link');
    expect(link.textContent).toBe('0');
    expect(link.getAttribute('href')).toBe('/appointments?doctorId=2&status=NO_SHOW&from=2026-09-20&to=2026-10-19');
  });

  it('HMS-7 REQ-8: the other sections are still shown', async () => {
    renderPage(DOCTOR);
    await screen.findByText('No-shows (last 30 days)');
    for (const name of ['Weekly availability', 'Upcoming appointments', 'Day schedule']) {
      expect(screen.getByRole('heading', { name })).toBeTruthy();
    }
  });

  it('HMS-7 REQ-6 edge: noShowsQuery uses the exact parameter names the list reads', () => {
    expect(noShowsQuery(7, WINDOW)).toBe('doctorId=7&status=NO_SHOW&from=2026-09-20&to=2026-10-19');
  });
});
