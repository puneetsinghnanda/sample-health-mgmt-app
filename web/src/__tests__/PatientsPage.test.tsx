import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Page, PatientListItem } from '../api/types';
import { PatientsPage } from '../pages/PatientsPage';

const BASE = { dateOfBirth: '1990-01-01', age: 36, gender: 'OTHER', phone: '+91 00000 00000', status: 'ACTIVE' as const, registeredAt: '2026-10-01T04:30:00Z' };

const DATA: Page<PatientListItem> = {
  items: [
    { ...BASE, id: 1, code: 'P-000001', fullName: 'Test Patient 001', next_appointment: null, last_visit: null },
    { ...BASE, id: 2, code: 'P-000002', fullName: 'Test Patient 002', next_appointment: { id: 7, starts_at: '2026-10-28T04:30:00Z', doctor_name: 'Test Doctor 001' }, last_visit: null },
  ],
  page: 1,
  page_size: 20,
  total: 2,
};

async function nextCell(name: string): Promise<HTMLElement> {
  const row = (await screen.findByText(name)).closest('tr')!;
  const cells = within(row).getAllByRole('cell');
  // HMS-27 (REQ-1): "Last visit" now follows "Next appointment", so find the column by its header.
  const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
  return cells[headers.indexOf('Next appointment')]!;
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

describe('PatientsPage last visit column and not-seen filter (HMS-27)', () => {
  const WITH_VISIT: Page<PatientListItem> = {
    ...DATA,
    items: [
      DATA.items[0]!,
      { ...DATA.items[1]!, last_visit: { date: '2026-03-10', doctor_name: 'Test Doctor 002' } },
    ],
  };

  function renderAt(page: Page<PatientListItem>, url = '/patients') {
    const fetchMock = vi.fn<(url: RequestInfo | URL) => Promise<Response>>(async () => new Response(JSON.stringify(page), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={[url]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PatientsPage />
      </MemoryRouter>,
    );
    return fetchMock;
  }

  async function lastVisitCell(name: string): Promise<HTMLElement> {
    const row = (await screen.findByText(name)).closest('tr')!;
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    return within(row).getAllByRole('cell')[headers.indexOf('Last visit')]!;
  }

  it('HMS-27 REQ-1: the Last visit column comes directly after Next appointment', async () => {
    renderAt(WITH_VISIT);
    await screen.findByText('Test Patient 001');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers.indexOf('Last visit')).toBe(headers.indexOf('Next appointment') + 1);
  });

  it('HMS-27 REQ-3, REQ-4: shows the date (no time) and the doctor of the last visit', async () => {
    renderAt(WITH_VISIT);
    expect((await lastVisitCell('Test Patient 002')).textContent).toBe('10 Mar 2026 · Test Doctor 002');
  });

  it('HMS-27 REQ-5: a patient with no visit shows "Never"', async () => {
    renderAt(WITH_VISIT);
    expect((await lastVisitCell('Test Patient 001')).textContent).toBe('Never');
  });

  it('HMS-27 REQ-6: the Not seen for a year filter sits next to the status filter and starts off', async () => {
    const fetchMock = renderAt(WITH_VISIT);
    const box = await screen.findByLabelText('Not seen for a year') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.closest('form')).toBe(screen.getByLabelText('Status').closest('form'));
    expect(String(fetchMock.mock.calls[0]![0])).not.toContain('not_seen');
  });

  it('HMS-27 REQ-6, REQ-11: turning the filter on sends not_seen=true and goes back to page 1', async () => {
    const fetchMock = renderAt(WITH_VISIT, '/patients?page=2&status=INACTIVE');
    await screen.findByText('Test Patient 001');
    expect(String(fetchMock.mock.calls[0]![0])).toContain('page=2');
    fireEvent.click(screen.getByLabelText('Not seen for a year'));
    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1));
    const url = String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1]![0]);
    expect(url).toContain('not_seen=true');
    expect(url).toContain('status=INACTIVE');
    expect(url).toContain('page=1');
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
