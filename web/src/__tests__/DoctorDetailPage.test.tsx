import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { DoctorDetail } from '../api/types';
import { DoctorDetailPage, noShowsQuery, validDay } from '../pages/DoctorDetailPage';

const WINDOW = { from: '2026-09-20', to: '2026-10-19' };

const DOCTOR: DoctorDetail = {
  id: 1, code: 'D-0001', fullName: 'Test Doctor 001',
  specialization: { id: 1, name: 'Test Specialization 001', status: 'ACTIVE' },
  department: { id: 1, name: 'Test Department 001', status: 'ACTIVE' },
  phone: '+91 00000 00000', email: null, feePaise: 50000, slotMinutes: 15, status: 'ACTIVE',
  availability: [], upcoming: [], outsideAvailability: [], appointmentCount: 4,
  noShowsLast30Days: 3, noShowsWindow: WINDOW, nextSevenDays: null,
};

function renderPage(doctor: DoctorDetail, path = `/doctors/${doctor.id}`) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(
    JSON.stringify(url.includes('/slots') ?{ doctorId: doctor.id, date: WINDOW.to, slotMinutes: 15, slots: [], appointments: [] } : doctor),
    { status: 200 },
  )));
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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

const WEEK: DoctorDetail['nextSevenDays'] = [
  { date: '2026-10-19', available: true, booked: 1, free: 2 },
  { date: '2026-10-20', available: true, booked: 0, free: 0 },
  { date: '2026-10-21', available: false, booked: null, free: null },
  { date: '2026-10-22', available: true, booked: 3, free: 4 },
  { date: '2026-10-23', available: true, booked: 0, free: 12 },
  { date: '2026-10-24', available: false, booked: null, free: null },
  { date: '2026-10-25', available: false, booked: null, free: null },
];

async function nextRows(): Promise<HTMLElement[]> {
  const heading = await screen.findByRole('heading', { name: 'Next 7 days' });
  const table = heading.nextElementSibling as HTMLElement;
  return within(table).getAllByRole('row').slice(1);
}

describe('DoctorDetailPage Next 7 days (HMS-9)', () => {
  it('HMS-9 REQ-1/REQ-3: shows one row per day with the date, booked and free', async () => {
    renderPage({ ...DOCTOR, nextSevenDays: WEEK });
    const rows = await nextRows();
    expect(rows).toHaveLength(7);
    expect(within(rows[0]!).getAllByRole('cell').map((c) => c.textContent)).toEqual(['2026-10-19', '1', '2']);
  });

  it('HMS-9 REQ-6: a day with no free slots left shows 0, not "Not available"', async () => {
    renderPage({ ...DOCTOR, nextSevenDays: WEEK });
    const rows = await nextRows();
    expect(within(rows[1]!).getAllByRole('cell').map((c) => c.textContent)).toEqual(['2026-10-20', '0', '0']);
  });

  it('HMS-9 REQ-5: a day without slots shows "Not available" instead of counts', async () => {
    renderPage({ ...DOCTOR, nextSevenDays: WEEK });
    const rows = await nextRows();
    expect(within(rows[2]!).getAllByRole('cell').map((c) => c.textContent)).toEqual(['2026-10-21', 'Not available']);
  });

  it('HMS-9 REQ-7: each date links to the doctor page with ?date= for that day', async () => {
    renderPage({ ...DOCTOR, nextSevenDays: WEEK });
    const rows = await nextRows();
    expect(within(rows[3]!).getByRole('link').getAttribute('href')).toBe('/doctors/1?date=2026-10-22');
  });

  it('HMS-9 REQ-9: no section when nextSevenDays is null (Inactive doctor)', async () => {
    renderPage({ ...DOCTOR, status: 'INACTIVE', nextSevenDays: null });
    await screen.findByText('No-shows (last 30 days)');
    expect(screen.queryByRole('heading', { name: 'Next 7 days' })).toBeNull();
  });

  it('HMS-9 REQ-10: the other sections are still shown with the new section', async () => {
    renderPage({ ...DOCTOR, nextSevenDays: WEEK });
    await nextRows();
    for (const name of ['Weekly availability', 'Upcoming appointments', 'Day schedule']) {
      expect(screen.getByRole('heading', { name })).toBeTruthy();
    }
  });

  it('HMS-9 REQ-8: ?date= opens the day schedule on that date', async () => {
    renderPage({ ...DOCTOR, nextSevenDays: WEEK }, '/doctors/1?date=2026-10-22');
    const input = (await screen.findByLabelText(/Date/)) as HTMLInputElement;
    expect(input.value).toBe('2026-10-22');
  });

  it('HMS-9 REQ-8 edge (S-3 AC3): without ?date= the day schedule starts at local today, across UTC midnight', async () => {
    // 2026-11-11T19:00Z is 00:30 on 12 Nov in Asia/Kolkata (UTC+05:30), the settings default zone.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T19:00:00Z'));
    try {
      renderPage({ ...DOCTOR, nextSevenDays: WEEK });
      const input = (await screen.findByLabelText(/Date/)) as HTMLInputElement;
      expect(input.value).toBe('2026-11-12');
    } finally {
      vi.useRealTimers();
    }
  });

  it('HMS-9 REQ-5 (S-4 AC3): a doctor with no availability shows "Not available" on every row', async () => {
    const none = WEEK!.map((n) => ({ date: n.date, available: false, booked: null, free: null }));
    renderPage({ ...DOCTOR, availability: [], nextSevenDays: none });
    const rows = await nextRows();
    expect(rows).toHaveLength(7);
    for (const row of rows) expect(within(row).getAllByRole('cell')[1]!.textContent).toBe('Not available');
    expect(screen.getByText('No availability set.')).toBeTruthy();
  });

  it('HMS-9 REQ-8 error: an invalid ?date= is ignored', async () => {
    renderPage({ ...DOCTOR, nextSevenDays: WEEK }, '/doctors/1?date=2026-02-30');
    const input = (await screen.findByLabelText(/Date/)) as HTMLInputElement;
    expect(input.value).not.toBe('2026-02-30');
    expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('HMS-9 REQ-8 edge: validDay accepts only real YYYY-MM-DD days', () => {
    expect(validDay('2026-10-22')).toBe('2026-10-22');
    expect(validDay('2028-02-29')).toBe('2028-02-29');
    expect(validDay('2026-02-30')).toBeNull();
    expect(validDay('2026-1-5')).toBeNull();
    expect(validDay('<b>x</b>')).toBeNull();
    expect(validDay('')).toBeNull();
    expect(validDay(null)).toBeNull();
  });
});
