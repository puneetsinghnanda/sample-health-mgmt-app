import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Page, PatientListItem } from '../api/types';
import { PatientsPage } from '../pages/PatientsPage';

const BASE = { dateOfBirth: '1990-01-01', age: 36, gender: 'OTHER', phone: '+91 00000 00000', status: 'ACTIVE' as const, registeredAt: '2026-10-01T04:30:00Z' };

const DATA: Page<PatientListItem> = {
  items: [
    { ...BASE, id: 1, code: 'P-000001', fullName: 'Test Patient 001', next_appointment: null },
    { ...BASE, id: 2, code: 'P-000002', fullName: 'Test Patient 002', next_appointment: { id: 7, starts_at: '2026-10-28T04:30:00Z', doctor_name: 'Test Doctor 001' } },
  ],
  page: 1,
  page_size: 20,
  total: 2,
};

async function nextCell(name: string): Promise<HTMLElement> {
  const row = (await screen.findByText(name)).closest('tr')!;
  const cells = within(row).getAllByRole('cell');
  return cells[cells.length - 1]!;
}

describe('PatientsPage next appointment column (HMS-2)', () => {
  it('HMS-2: shows "-" when the patient has no upcoming Scheduled appointment', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(DATA), { status: 200 })));
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PatientsPage />
      </MemoryRouter>,
    );
    const cell = await nextCell('Test Patient 001');
    expect(cell.textContent).toBe('-');
    expect(within(cell).queryByRole('link')).toBeNull();
  });

  it('HMS-2: an upcoming appointment still shows its doctor, linked to the appointment', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(DATA), { status: 200 })));
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PatientsPage />
      </MemoryRouter>,
    );
    const link = within(await nextCell('Test Patient 002')).getByRole('link');
    expect(link.getAttribute('href')).toBe('/appointments/7');
    expect(link.textContent).toContain('Test Doctor 001');
    expect(link.textContent).not.toBe('-');
  });
});

describe('PatientsPage match count (LIVE-1)', () => {
  function renderWith(page: Page<PatientListItem>) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(page), { status: 200 })));
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PatientsPage />
      </MemoryRouter>,
    );
  }

  it('REQ-1, REQ-5: shows every match from total, not only the rows on this page', async () => {
    renderWith({ ...DATA, total: 12 });
    expect(await screen.findByText('12 patients')).toBeTruthy();
    expect(screen.queryByText('2 patients')).toBeNull();
  });

  it('REQ-2: the count follows a change of the search text', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => new Response(JSON.stringify({ ...DATA, total: 12 }), { status: 200 }))
      .mockImplementation(async () => new Response(JSON.stringify({ ...DATA, items: [DATA.items[0]!], total: 3 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PatientsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('12 patients')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search by name, code or phone'), { target: { value: 'Test Patient 001' } });
    expect(await screen.findByText('3 patients')).toBeTruthy();
    expect(screen.queryByText('12 patients')).toBeNull();
  });

  it('REQ-1: a failed list request shows the error and no count line', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Test failure 001' } }), { status: 500 })));
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PatientsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Test failure 001')).toBeTruthy();
    expect(screen.queryByText(/^\d+ patients?$/)).toBeNull();
  });

  it('REQ-1: one match reads "1 patient"', async () => {
    renderWith({ ...DATA, items: [DATA.items[0]!], total: 1 });
    expect(await screen.findByText('1 patient')).toBeTruthy();
  });

  it('REQ-3, REQ-4: no match shows "0 patients" and keeps the empty message', async () => {
    renderWith({ ...DATA, items: [], total: 0 });
    expect(await screen.findByText('0 patients')).toBeTruthy();
    expect(screen.getByText('No patients match.')).toBeTruthy();
  });
});
