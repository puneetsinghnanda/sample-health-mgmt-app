import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Page, PatientListItem } from '../api/types';
import { PatientsPage } from '../pages/PatientsPage';

const BASE = { dateOfBirth: '1990-01-01', age: 36, gender: 'OTHER', phone: '+91 00000 00000', status: 'ACTIVE' as const, registeredAt: '2026-10-01T04:30:00Z' };

const DATA: Page<PatientListItem> = {
  items: [
    { ...BASE, id: 1, code: 'P-000001', fullName: 'Test Patient 001', next_appointment: null, last_visit_date: null },
    { ...BASE, id: 2, code: 'P-000002', fullName: 'Test Patient 002', next_appointment: { id: 7, starts_at: '2026-10-28T04:30:00Z', doctor_name: 'Test Doctor 001' }, last_visit_date: '2026-10-27' },
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

/** HMS-4: the Last visit column sits just before Next appointment. */
async function lastVisitCell(name: string): Promise<HTMLElement> {
  const row = (await screen.findByText(name)).closest('tr')!;
  const cells = within(row).getAllByRole('cell');
  return cells[cells.length - 2]!;
}

describe('PatientsPage last visit column (HMS-4)', () => {
  const zone = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/New_York';
  });
  afterAll(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it('HMS-4 REQ-3 (S-1 AC4): shows the hospital-local day as returned when the browser zone is west of UTC', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(DATA), { status: 200 })));
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PatientsPage />
      </MemoryRouter>,
    );
    expect((await lastVisitCell('Test Patient 002')).textContent).toBe('2026-10-27');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toContain('Last visit');
  });

  it('HMS-4 REQ-8: shows "-" when the patient has no Completed appointment', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(DATA), { status: 200 })));
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PatientsPage />
      </MemoryRouter>,
    );
    expect((await lastVisitCell('Test Patient 001')).textContent).toBe('-');
  });

  it('HMS-4 REQ-1, REQ-12: Last visit sits just before Next appointment, which stays the last column', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(DATA), { status: 200 })));
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PatientsPage />
      </MemoryRouter>,
    );
    await screen.findByText('Test Patient 001');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent).slice(-2)).toEqual(['Last visit', 'Next appointment']);
  });
});

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
