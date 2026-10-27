import { render, screen, within } from '@testing-library/react';
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
