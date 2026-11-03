import { render, screen, within } from '@testing-library/react';
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
    { ...BASE, id: 1, code: 'D-0001', fullName: 'Test Doctor 001', today_count: 3 },
    { ...BASE, id: 2, code: 'D-0002', fullName: 'Test Doctor 002', today_count: 0 },
  ],
  page: 1,
  page_size: 20,
  total: 2,
};

function renderPage() {
  const fetchMock = vi.fn(async (url: string) =>
    new Response(JSON.stringify(url.startsWith('/api/doctors') ? DATA : { items: [] }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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
  it('HMS-6 REQ-1, REQ-11: adds a Today column after the existing columns', async () => {
    renderPage();
    await screen.findByText('Test Doctor 001');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Code', 'Name', 'Specialization', 'Department', 'Fee', 'Status', 'Today']);
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
