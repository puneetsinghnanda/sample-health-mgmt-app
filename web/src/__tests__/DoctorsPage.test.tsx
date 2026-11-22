import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { DoctorListRow, Page } from '../api/types';
import { todayIn } from '../lib/format';
import { DoctorsPage } from '../pages/DoctorsPage';

const BASE = {
  specialization: { id: 1, name: 'Test Specialization 001', status: 'ACTIVE' as const },
  department: { id: 1, name: 'Test Department 001', status: 'ACTIVE' as const },
  phone: '+91 00000 00000', email: null, feePaise: 50000, slotMinutes: 15, status: 'ACTIVE' as const,
};

const DATA: Page<DoctorListRow> = {
  items: [
    { ...BASE, id: 1, code: 'D-0001', fullName: 'Test Doctor 001', today_count: 3, weekdays: [1, 3] },
    { ...BASE, id: 2, code: 'D-0002', fullName: 'Test Doctor 002', today_count: 0, weekdays: [] },
    { ...BASE, id: 3, code: 'D-0003', fullName: 'Test Doctor 003', today_count: 0, weekdays: [1, 6, 7], status: 'INACTIVE' },
  ],
  page: 1,
  page_size: 20,
  total: 3,
};

function renderPage(entry = '/doctors') {
  const fetchMock = vi.fn(async (url: string) =>
    new Response(JSON.stringify(url.startsWith('/api/doctors') ? DATA : { items: [] }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  render(
    <MemoryRouter initialEntries={[entry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <DoctorsPage />
    </MemoryRouter>,
  );
  return fetchMock;
}

async function todayCell(name: string): Promise<HTMLElement> {
  const row = (await screen.findByText(name)).closest('tr')!;
  const cells = within(row).getAllByRole('cell');
  return cells[cells.length - 1]!;
}

describe('DoctorsPage Today column (HMS-6)', () => {
  it('HMS-6 REQ-1, REQ-11, HMS-28 REQ-13: Today stays last, after the Works on column', async () => {
    renderPage();
    await screen.findByText('Test Doctor 001');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Code', 'Name', 'Specialization', 'Department', 'Fee', 'Status', 'Works on', 'Today']);
  });

  it("HMS-6 REQ-2: asks the API for today's counts", async () => {
    const fetchMock = renderPage();
    await screen.findByText('Test Doctor 001');
    const doctorsCall = fetchMock.mock.calls.map(([url]) => url).find((url) => url.startsWith('/api/doctors'));
    expect(doctorsCall).toContain('with_today=true');
  });

  it("HMS-6 REQ-6, REQ-7: the count links to that doctor's appointments today", async () => {
    renderPage();
    const link = within(await todayCell('Test Doctor 001')).getByRole('link');
    const today = todayIn('Asia/Kolkata');
    expect(link.textContent).toBe('3');
    expect(link.getAttribute('href')).toBe(`/appointments?doctorId=1&from=${today}&to=${today}`);
  });

  it('HMS-6 REQ-5: a doctor with no appointments today shows 0, still linked', async () => {
    renderPage();
    const link = within(await todayCell('Test Doctor 002')).getByRole('link');
    expect(link.textContent).toBe('0');
    expect(link.getAttribute('href')).toContain('doctorId=2');
  });
});

async function worksOnCell(name: string): Promise<HTMLElement> {
  const row = (await screen.findByText(name)).closest('tr')!;
  const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
  return within(row).getAllByRole('cell')[headers.indexOf('Works on')]!;
}

const doctorsCalls = (fetchMock: ReturnType<typeof renderPage>) =>
  fetchMock.mock.calls.map(([url]) => url as string).filter((url) => url.startsWith('/api/doctors'));

describe('DoctorsPage Works on column and filter (HMS-28)', () => {
  it('HMS-28 REQ-1, REQ-2: shows short weekday names in Mon..Sun order, comma-separated', async () => {
    renderPage();
    expect((await worksOnCell('Test Doctor 001')).textContent).toBe('Mon, Wed');
    expect((await worksOnCell('Test Doctor 003')).textContent).toBe('Mon, Sat, Sun');
  });

  it('HMS-28 REQ-3: a doctor with no availability shows "No availability"', async () => {
    renderPage();
    expect((await worksOnCell('Test Doctor 002')).textContent).toBe('No availability');
  });

  it('HMS-28 REQ-11: an Inactive doctor still shows weekdays', async () => {
    renderPage();
    expect((await worksOnCell('Test Doctor 003')).textContent).not.toBe('No availability');
  });

  it('HMS-28 REQ-4, REQ-5, REQ-14: the filter offers Any day (default) and Monday to Sunday', async () => {
    renderPage();
    await screen.findByText('Test Doctor 001');
    const select = screen.getByLabelText('Works on') as HTMLSelectElement;
    const options = Array.from(select.options);
    expect(options.map((o) => o.textContent)).toEqual([
      'Any day', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    ]);
    expect(options.map((o) => o.value)).toEqual(['', '1', '2', '3', '4', '5', '6', '7']);
    expect(select.value).toBe('');
  });

  it('HMS-28 REQ-5: with Any day the API is not asked to filter by weekday', async () => {
    const fetchMock = renderPage();
    await screen.findByText('Test Doctor 001');
    expect(doctorsCalls(fetchMock).every((url) => !url.includes('weekday='))).toBe(true);
  });

  it('HMS-28 REQ-6, REQ-10: choosing Sunday asks the API for weekday=7 and resets the page', async () => {
    const fetchMock = renderPage('/doctors?page=2');
    await screen.findByText('Test Doctor 001');
    fireEvent.change(screen.getByLabelText('Works on'), { target: { value: '7' } });
    await waitFor(() => expect(doctorsCalls(fetchMock).some((url) => url.includes('weekday=7'))).toBe(true));
    const calls = doctorsCalls(fetchMock);
    const last = calls[calls.length - 1]!;
    expect(last).toContain('weekday=7');
    expect(last).not.toContain('page=2');
  });

  it('HMS-28 REQ-10: a weekday in the page address selects it and filters the list', async () => {
    const fetchMock = renderPage('/doctors?weekday=6');
    await screen.findByText('Test Doctor 001');
    expect((screen.getByLabelText('Works on') as HTMLSelectElement).value).toBe('6');
    expect(doctorsCalls(fetchMock)[0]).toContain('weekday=6');
  });

  it('HMS-28 REQ-7: the weekday is sent together with the other filters', async () => {
    const fetchMock = renderPage('/doctors?weekday=6&departmentId=1&status=ACTIVE&q=Test');
    await screen.findByText('Test Doctor 001');
    const call = doctorsCalls(fetchMock)[0]!;
    for (const part of ['weekday=6', 'departmentId=1', 'status=ACTIVE', 'q=Test']) expect(call).toContain(part);
  });
});
