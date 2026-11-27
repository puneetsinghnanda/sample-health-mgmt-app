import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Dashboard, OnDutyRow } from '../api/types';
import { DashboardPage } from '../pages/DashboardPage';

const DATA: Dashboard = {
  today: '2026-10-19',
  period: { name: 'today', from: '2026-10-19', to: '2026-10-19' },
  totals: { patients: 200, doctors: 12, appointmentsToday: 31, upcoming: 140, completed: 9, cancelled: 2, noShows: 4 },
  next: [],
  onDuty: [],
};

describe('DashboardPage (PRD §4.4)', () => {
  it('DSH-1..6 tiles show the counts and DSH-8 each links to the list it counts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(DATA), { status: 200 })));
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DashboardPage />
      </MemoryRouter>,
    );
    const cancelled = await screen.findByRole('link', { name: /Cancelled/ });
    expect(cancelled.textContent).toContain('2');
    expect(cancelled.getAttribute('href')).toBe('/appointments?status=CANCELLED&from=2026-10-19&to=2026-10-19');
    expect(screen.getByRole('link', { name: /Total patients/ }).textContent).toContain('200');
    expect(screen.getByRole('link', { name: /Appointments today/ }).getAttribute('href')).toBe('/appointments?from=2026-10-19&to=2026-10-19');
  });

  it('HMS-3 REQ-1/REQ-6/REQ-7: the No-shows tile shows its count and links to the No-show list for the period', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(DATA), { status: 200 })));
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DashboardPage />
      </MemoryRouter>,
    );
    const tile = await screen.findByRole('link', { name: /No-shows/ });
    expect(tile.textContent).toBe('4No-shows');
    expect(tile.getAttribute('href')).toBe('/appointments?status=NO_SHOW&from=2026-10-19&to=2026-10-19');
  });

  it('HMS-3 REQ-5/REQ-7: changing the period reloads the No-shows count and moves its link to that period', async () => {
    const week: Dashboard = { ...DATA, period: { name: '7d', from: '2026-10-13', to: '2026-10-19' }, totals: { ...DATA.totals, noShows: 11 } };
    const fetchMock = vi.fn(async (url: string) =>
      new Response(JSON.stringify(String(url).includes('period=7d') ? week : DATA), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DashboardPage />
      </MemoryRouter>,
    );
    await screen.findByRole('link', { name: /4\s*No-shows/ });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '7d' } });
    const tile = await screen.findByRole('link', { name: /11\s*No-shows/ });
    expect(tile.getAttribute('href')).toBe('/appointments?status=NO_SHOW&from=2026-10-13&to=2026-10-19');
  });

  it('HMS-3 REQ-2 edge: a period with no No-shows shows 0', async () => {
    const none: Dashboard = { ...DATA, totals: { ...DATA.totals, noShows: 0 } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(none), { status: 200 })));
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DashboardPage />
      </MemoryRouter>,
    );
    expect((await screen.findByRole('link', { name: /No-shows/ })).textContent).toBe('0No-shows');
  });
});

describe('DashboardPage On duty today (HMS-23)', () => {
  // Invented rows in the order the API sends them (most free first). 04:00Z is 09:30 in Asia/Kolkata.
  const ROWS: OnDutyRow[] = [
    { doctorId: 12, fullName: 'Test Doctor B', department: { name: 'Outpatient', status: 'ACTIVE' }, booked: 0, free: 4, nextFree: { start: '2026-10-19T04:00:00.000Z', label: '09:30' } },
    { doctorId: 13, fullName: 'Test Doctor C', department: { name: 'Surgery', status: 'INACTIVE' }, booked: 2, free: 2, nextFree: { start: '2026-10-19T05:30:00.000Z', label: '11:00' } },
    { doctorId: 11, fullName: 'Test Doctor A', department: { name: 'Outpatient', status: 'ACTIVE' }, booked: 3, free: 0, nextFree: null },
  ];
  const WITH_ROWS: Dashboard = { ...DATA, onDuty: ROWS };

  const renderWith = (data: Dashboard | ((url: string) => Dashboard)) => {
    const fetchMock = vi.fn(async (url: string) =>
      new Response(JSON.stringify(typeof data === 'function' ? data(String(url)) : data), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DashboardPage />
      </MemoryRouter>,
    );
  };
  const rowsOf = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('tr.on-duty-row')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent));

  it('HMS-23 REQ-1 (S-1 AC1): the On duty today section sits below the tiles and above Next appointments', async () => {
    const { container } = renderWith(WITH_ROWS);
    const heading = await screen.findByRole('heading', { name: 'On duty today' });
    const tile = screen.getByRole('link', { name: /Total patients/ });
    const next = screen.getByRole('heading', { name: 'Next appointments' });
    expect(tile.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rowsOf(container)).toHaveLength(3);
  });

  it('HMS-23 REQ-14 (S-1 AC4): an empty list shows "No doctors on duty today" and no rows', async () => {
    const { container } = renderWith(DATA);
    expect(await screen.findByText('No doctors on duty today')).toBeTruthy();
    expect(rowsOf(container)).toEqual([]);
  });

  it('HMS-23 REQ-4/REQ-5/REQ-6/REQ-7/REQ-8/REQ-9/REQ-12 (S-2 AC1, S-2 AC2, S-1 AC5, S-4 AC3): each row shows name, department with the Inactive marker, booked, free and next free label or Fully booked', async () => {
    const { container } = renderWith(WITH_ROWS);
    await screen.findByRole('heading', { name: 'On duty today' });
    expect(rowsOf(container)).toEqual([
      ['Test Doctor B', 'Outpatient', '0', '4', '09:30'],
      ['Test Doctor C', 'Surgery (Inactive)', '2', '2', '11:00'],
      ['Test Doctor A', 'Outpatient', '3', '0', 'Fully booked'],
    ]);
    expect(container.textContent).not.toContain('2026-10-19T04:00');
  });

  it('HMS-23 REQ-12/REQ-19 (S-4 AC4): a doctor with free 0 and no next slot stays listed as Fully booked', async () => {
    const passed: OnDutyRow = { doctorId: 21, fullName: 'Test Doctor D', department: { name: 'Outpatient', status: 'ACTIVE' }, booked: 0, free: 0, nextFree: null };
    const { container } = renderWith({ ...DATA, onDuty: [passed] });
    await screen.findByRole('heading', { name: 'On duty today' });
    expect(rowsOf(container)).toEqual([['Test Doctor D', 'Outpatient', '0', '0', 'Fully booked']]);
    expect(screen.queryByText('No doctors on duty today')).toBeNull();
  });

  it('HMS-23 REQ-10/REQ-11 (S-5 AC1, S-5 AC3): rows keep the API order, so most free comes first and Fully booked last', async () => {
    const { container } = renderWith(WITH_ROWS);
    await screen.findByRole('heading', { name: 'On duty today' });
    expect(rowsOf(container).map((r) => r[0])).toEqual(['Test Doctor B', 'Test Doctor C', 'Test Doctor A']);
  });

  it('HMS-23 REQ-13 (S-6 AC1, S-6 AC2): the name links to the doctor page with ?date= set to the dashboard’s local today', async () => {
    renderWith({ ...DATA, today: '2026-11-28', period: { name: 'today', from: '2026-11-28', to: '2026-11-28' }, onDuty: ROWS });
    const link = await screen.findByRole('link', { name: 'Test Doctor A' });
    expect(link.getAttribute('href')).toBe('/doctors/11?date=2026-11-28');
    expect(screen.getByRole('link', { name: 'Test Doctor B' }).getAttribute('href')).toBe('/doctors/12?date=2026-11-28');
  });

  it('HMS-23 REQ-17 (S-2 AC3): contact details are never rendered, even if a response carried them', async () => {
    const leaky = { ...ROWS[0]!, phone: '+91 00000 19999', email: 'leak@example.com' } as OnDutyRow;
    renderWith({ ...DATA, onDuty: [leaky] });
    await screen.findByRole('link', { name: 'Test Doctor B' });
    expect(screen.queryByText(/\+91 00000 19999/)).toBeNull();
    expect(screen.queryByText(/leak@example\.com/)).toBeNull();
  });

  it('HMS-23 REQ-16 (S-7 AC1): changing the Period to Last 30 days keeps the same rows', async () => {
    const month: Dashboard = { ...WITH_ROWS, period: { name: '30d', from: '2026-09-20', to: '2026-10-19' }, totals: { ...DATA.totals, noShows: 15 } };
    const { container } = renderWith((url) => (url.includes('period=30d') ? month : WITH_ROWS));
    await screen.findByRole('heading', { name: 'On duty today' });
    const before = rowsOf(container);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '30d' } });
    await screen.findByRole('link', { name: /15\s*No-shows/ });
    expect(rowsOf(container)).toEqual(before);
  });

  it('HMS-23 REQ-18 (S-7 AC2, S-7 AC3): with on-duty rows the tiles and their links are unchanged', async () => {
    renderWith(WITH_ROWS);
    const cancelled = await screen.findByRole('link', { name: /Cancelled/ });
    expect(cancelled.getAttribute('href')).toBe('/appointments?status=CANCELLED&from=2026-10-19&to=2026-10-19');
    expect(screen.getByRole('link', { name: /Total patients/ }).textContent).toBe('200Total patients');
    expect(screen.getByRole('link', { name: /Upcoming appointments/ }).getAttribute('href')).toBe('/appointments?status=SCHEDULED&from=2026-10-19');
    expect(screen.getByRole('heading', { name: 'Next appointments' })).toBeTruthy();
  });
});
