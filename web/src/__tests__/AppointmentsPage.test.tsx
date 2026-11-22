import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AppointmentStatusCounts, AppointmentSummary, Page } from '../api/types';
import { AppointmentsPage } from '../pages/AppointmentsPage';

const ROW: AppointmentSummary = {
  id: 1,
  code: 'A-000001',
  doctor: { id: 1, code: 'D-0001', fullName: 'Test Doctor 001' },
  patient: { id: 1, code: 'P-000001', fullName: 'Test Patient 001' },
  startsAt: '2026-10-19T03:30:00Z',
  endsAt: '2026-10-19T03:45:00Z',
  status: 'SCHEDULED',
};

type ListPage = Page<AppointmentSummary> & { status_counts: AppointmentStatusCounts };

const DATA: ListPage = {
  items: [ROW],
  page: 2,
  page_size: 20,
  total: 34,
  status_counts: { SCHEDULED: 4, COMPLETED: 25, CANCELLED: 3, NO_SHOW: 2 },
};

function renderAt(url: string, data: ListPage = DATA) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(data), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  render(
    <MemoryRouter initialEntries={[url]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppointmentsPage />
    </MemoryRouter>,
  );
  return fetchMock;
}

const counts = async () => within(await screen.findByLabelText('Count per status'));

describe('AppointmentsPage status counts (HMS-30)', () => {
  it('HMS-30 REQ-1/REQ-2/REQ-3: shows the four counts next to the total, in order, joined by " · "', async () => {
    renderAt('/appointments?doctorId=1');
    const line = (await screen.findByLabelText('Count per status')).closest('p')!;
    expect(line.textContent).toBe('34 appointment(s) · Scheduled 4 · Completed 25 · Cancelled 3 · No-show 2');
  });

  it('HMS-30 REQ-6: a status with no appointments shows 0, still linked', async () => {
    renderAt('/appointments?patientId=1', { ...DATA, total: 29, status_counts: { SCHEDULED: 4, COMPLETED: 25, CANCELLED: 0, NO_SHOW: 0 } });
    const c = await counts();
    expect(c.getByRole('link', { name: 'Cancelled 0' })).toBeTruthy();
    expect(c.getByRole('link', { name: 'No-show 0' })).toBeTruthy();
  });

  it('HMS-30 REQ-7: each count links to the same list with that status, keeping the other filters, on page 1', async () => {
    renderAt('/appointments?doctorId=1&from=2026-10-19&to=2026-10-20&page=2');
    const href = (await counts()).getByRole('link', { name: 'Completed 25' }).getAttribute('href')!;
    const [path, q] = href.split('?');
    expect(path).toBe('/appointments');
    const params = new URLSearchParams(q);
    expect(params.get('status')).toBe('COMPLETED');
    expect(params.get('doctorId')).toBe('1');
    expect(params.get('from')).toBe('2026-10-19');
    expect(params.get('to')).toBe('2026-10-20');
    expect(params.has('page')).toBe(false);
  });

  it('HMS-30 REQ-7 edge: with a Status already set, a count replaces it rather than adding a second one', async () => {
    renderAt('/appointments?patientId=1&status=SCHEDULED');
    const href = (await counts()).getByRole('link', { name: 'No-show 2' }).getAttribute('href')!;
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.getAll('status')).toEqual(['NO_SHOW']);
    expect(params.get('patientId')).toBe('1');
  });

  it('HMS-30 REQ-9/REQ-11: the table and the Status filter are still shown', async () => {
    renderAt('/appointments?doctorId=1');
    expect(await screen.findByText('A-000001')).toBeTruthy();
    expect(screen.getByLabelText('Status')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Any status' })).toBeTruthy();
  });

  it('HMS-30 REQ-1 error: a failed list request shows the error and no counts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Test failure 001' } }), { status: 500 })));
    render(
      <MemoryRouter initialEntries={['/appointments']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppointmentsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Test failure 001')).toBeTruthy();
    expect(screen.queryByLabelText('Count per status')).toBeNull();
  });
});
