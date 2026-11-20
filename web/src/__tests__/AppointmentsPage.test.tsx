import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppointmentDetail, AppointmentListItem, AppointmentStatus, AppointmentSummary, Page } from '../api/types';
import { AppointmentTable } from '../components/AppointmentTable';
import { AppointmentDetailPage } from '../pages/AppointmentDetailPage';
import { AppointmentsPage } from '../pages/AppointmentsPage';

const SIXTY = 'A'.repeat(60);
const LONG300 = 'B'.repeat(300);

function item(id: number, status: AppointmentStatus, cancellationReason: string | null): AppointmentListItem {
  return {
    id,
    code: `A-${String(id).padStart(6, '0')}`,
    doctor: { id: 1, code: 'D-000001', fullName: 'Test Doctor 001' },
    patient: { id: 1, code: 'P-000001', fullName: 'Test Patient 001' },
    startsAt: '2026-10-19T03:30:00Z',
    endsAt: '2026-10-19T03:45:00Z',
    status,
    cancellationReason,
  };
}

function page(items: AppointmentListItem[], extra: Partial<Page<AppointmentListItem>> = {}): Page<AppointmentListItem> {
  return { items, page: 1, page_size: 20, total: items.length, ...extra };
}

function renderList(data: Page<AppointmentListItem>, url = '/appointments') {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(data), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  render(
    <MemoryRouter initialEntries={[url]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppointmentsPage />
    </MemoryRouter>,
  );
  return () => String((fetchMock.mock.calls as unknown[][])[0]?.[0]);
}

async function reasonCell(code: string): Promise<HTMLElement> {
  const row = (await screen.findByText(code)).closest('tr')!;
  const cells = within(row).getAllByRole('cell');
  return cells[cells.length - 1]!;
}

afterEach(() => vi.unstubAllGlobals());

describe('AppointmentsPage cancellation reason column (HMS-33)', () => {
  it('HMS-33 REQ-1, REQ-2 (S-1 AC1): the column "Cancellation reason" comes right after Status', async () => {
    renderList(page([item(1, 'SCHEDULED', null)]));
    await screen.findByText('A-000001');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers.at(-1)).toBe('Cancellation reason');
    expect(headers.at(-2)).toBe('Status');
  });

  it('HMS-33 REQ-3 (S-1 AC2): a Cancelled appointment shows its reason', async () => {
    renderList(page([item(1, 'CANCELLED', 'Patient travelling')]));
    expect((await reasonCell('A-000001')).textContent).toBe('Patient travelling');
  });

  it('HMS-33 REQ-6 (S-1 AC3): a reason of exactly 60 characters is shown whole', async () => {
    renderList(page([item(1, 'CANCELLED', SIXTY)]));
    const text = (await reasonCell('A-000001')).textContent!;
    expect(text).toBe(SIXTY);
    expect(text).not.toContain('…');
  });

  it('HMS-33 REQ-17 (S-1 AC4): the reason is shown as entered', async () => {
    renderList(page([item(1, 'CANCELLED', 'Fever, will rebook')]));
    expect((await reasonCell('A-000001')).textContent).toBe('Fever, will rebook');
  });

  it('HMS-33 REQ-5 (S-2 AC1): one character past 60 shows the first 60 and "…"', async () => {
    renderList(page([item(1, 'CANCELLED', `${SIXTY}Z`)]));
    const text = (await reasonCell('A-000001')).textContent!;
    expect(text).toBe(`${SIXTY}…`);
    expect(text).not.toContain('Z');
  });

  it('HMS-33 REQ-16 (S-2 AC2): a 300-character reason shows the first 60 and "…"', async () => {
    renderList(page([item(1, 'CANCELLED', LONG300)]));
    expect((await reasonCell('A-000001')).textContent).toBe(`${'B'.repeat(60)}…`);
  });

  it('HMS-33 REQ-7 (S-2 AC3): the appointment page still shows the full 300-character reason', async () => {
    const detail: AppointmentDetail = { ...item(1, 'CANCELLED', LONG300), reason: null, history: [] };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(detail), { status: 200 })));
    render(
      <MemoryRouter initialEntries={['/appointments/1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/appointments/:id" element={<AppointmentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const label = await screen.findByText('Cancellation reason');
    const value = label.nextElementSibling!;
    expect(value.textContent).toBe(LONG300);
    expect(value.textContent).not.toContain('…');
  });

  it('HMS-33 REQ-5: characters outside the basic plane are counted once and not split', async () => {
    renderList(page([item(1, 'CANCELLED', `${'😀'.repeat(61)}`)]));
    expect((await reasonCell('A-000001')).textContent).toBe(`${'😀'.repeat(60)}…`);
  });

  it('HMS-33 REQ-4 (S-3 AC1-AC3): Scheduled, Completed and No-show show "-"', async () => {
    renderList(page([item(1, 'SCHEDULED', null), item(2, 'COMPLETED', null), item(3, 'NO_SHOW', null)]));
    for (const code of ['A-000001', 'A-000002', 'A-000003']) {
      expect((await reasonCell(code)).textContent).toBe('-');
    }
  });

  it('HMS-33 REQ-4: a Cancelled appointment without a stored reason shows "-"', async () => {
    renderList(page([item(1, 'CANCELLED', null)]));
    expect((await reasonCell('A-000001')).textContent).toBe('-');
  });

  it('HMS-33 REQ-8, REQ-9 (S-4 AC1): the status filter is sent and every Cancelled row shows its reason', async () => {
    const firstUrl = renderList(page([item(1, 'CANCELLED', 'Reason one'), item(2, 'CANCELLED', 'Reason two')]), '/appointments?status=CANCELLED');
    expect((await reasonCell('A-000001')).textContent).toBe('Reason one');
    expect((await reasonCell('A-000002')).textContent).toBe('Reason two');
    expect(firstUrl()).toContain('status=CANCELLED');
  });

  it('HMS-33 REQ-8 (S-4 AC3): on the second page each row shows its own reason', async () => {
    const firstUrl = renderList(page([item(21, 'CANCELLED', 'Second page reason')], { page: 2, total: 21 }), '/appointments?page=2');
    expect((await reasonCell('A-000021')).textContent).toBe('Second page reason');
    expect(firstUrl()).toContain('page=2');
  });
});

describe('AppointmentTable without the column (HMS-33 REQ-10 to REQ-12)', () => {
  it('HMS-33 REQ-10, REQ-11, REQ-12 (S-5 AC1-AC3): other pages keep their columns, even for a Cancelled appointment', () => {
    const cancelled: AppointmentSummary & { cancellationReason: string } = { ...item(1, 'CANCELLED', 'Hidden reason'), cancellationReason: 'Hidden reason' };
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppointmentTable items={[cancelled]} />
      </MemoryRouter>,
    );
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Appointment', 'When', 'Doctor', 'Patient', 'Status']);
    expect(screen.queryByText('Hidden reason')).toBeNull();
  });

  it('HMS-33 REQ-14, REQ-15 (S-5 AC4): the list adds only the reason column, no medical history or contact details', async () => {
    renderList(page([item(1, 'CANCELLED', 'Patient travelling')]));
    await screen.findByText('A-000001');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Appointment', 'When', 'Doctor', 'Patient', 'Status', 'Cancellation reason']);
  });

  it('HMS-33 REQ-13 (S-6 AC1): the appointment code still links to its own page', async () => {
    renderList(page([item(7, 'CANCELLED', 'Patient travelling')]));
    const link = await screen.findByRole('link', { name: 'A-000007' });
    expect(link.getAttribute('href')).toBe('/appointments/7');
  });
});
