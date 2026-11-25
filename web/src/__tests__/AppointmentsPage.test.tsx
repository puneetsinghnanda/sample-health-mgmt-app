import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AppointmentSummary, Page } from '../api/types';
import { StatusBadge } from '../components/StatusBadge';
import { STATUS_LABEL } from '../lib/format';
import { AppointmentsPage } from '../pages/AppointmentsPage';

const BASE = {
  doctor: { id: 3, code: 'D-0003', fullName: 'Test Doctor 003' },
  patient: { id: 1, code: 'P-000001', fullName: 'Test Patient 001' },
};
const STALE: AppointmentSummary = { ...BASE, id: 5, code: 'A-000005', startsAt: '2026-12-03T04:30:00Z', endsAt: '2026-12-03T04:45:00Z', status: 'STALE' };
const SCHEDULED: AppointmentSummary = { ...BASE, id: 6, code: 'A-000006', startsAt: '2026-12-06T04:30:00Z', endsAt: '2026-12-06T04:45:00Z', status: 'SCHEDULED' };
const page = (items: AppointmentSummary[]): Page<AppointmentSummary> => ({ items, page: 1, page_size: 20, total: items.length });

function renderList(answer: (url: string) => Response) {
  const fetchMock = vi.fn(async (url: string) => answer(url));
  vi.stubGlobal('fetch', fetchMock);
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppointmentsPage />
    </MemoryRouter>,
  );
  return fetchMock;
}

async function statusOf(code: string): Promise<string | null> {
  const row = (await screen.findByText(code)).closest('tr')!;
  const cells = within(row).getAllByRole('cell');
  return cells[cells.length - 1]!.textContent;
}

describe('Stale on the appointment list (HMS-34)', () => {
  it('HMS-34 REQ-11 (S-5 AC1): the list shows Stale for a Stale appointment and Scheduled for the other', async () => {
    renderList(() => new Response(JSON.stringify(page([STALE, SCHEDULED])), { status: 200 }));
    expect(await statusOf('A-000005')).toBe('Stale');
    expect(await statusOf('A-000006')).toBe('Scheduled');
  });

  it('HMS-34 REQ-12 (S-5 AC3): the status filter offers Stale and asks the API for status=STALE', async () => {
    const fetchMock = renderList((url) =>
      new Response(JSON.stringify(page(url.includes('status=STALE') ? [STALE] : [STALE, SCHEDULED])), { status: 200 }));
    await screen.findByText('A-000006');
    const select = screen.getByLabelText('Status') as HTMLSelectElement;
    expect(within(select).getByRole('option', { name: 'Stale' }).getAttribute('value')).toBe('STALE');
    fireEvent.change(select, { target: { value: 'STALE' } });
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('/api/appointments?status=STALE', expect.anything()));
    await waitFor(() => expect(screen.queryByText('A-000006')).toBeNull());
    expect(screen.getByText('A-000005')).toBeTruthy();
    expect(screen.getByText('1 appointment(s)')).toBeTruthy();
  });

  it('HMS-34 REQ-12 error: a failed filtered list shows the error', async () => {
    renderList(() => new Response(JSON.stringify({ error: { message: 'Test failure 003' } }), { status: 500 }));
    expect(await screen.findByText('Test failure 003')).toBeTruthy();
  });

  it('HMS-34 REQ-11: StatusBadge labels STALE "Stale" with its own badge class', () => {
    expect(STATUS_LABEL.STALE).toBe('Stale');
    render(<StatusBadge status="STALE" />);
    expect(screen.getByText('Stale').className).toBe('badge badge-stale');
  });
});
