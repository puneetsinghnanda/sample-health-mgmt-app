import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppointmentsPage } from '../pages/AppointmentsPage';

const SPEC = { id: 1, name: 'Test Specialization 001', status: 'ACTIVE' as const };
const DOCTORS = [
  { id: 1, code: 'D-0001', fullName: 'Test Doctor 001', specialization: SPEC, status: 'ACTIVE' },
  { id: 2, code: 'D-0002', fullName: 'Test Doctor 002', specialization: SPEC, status: 'INACTIVE' },
];
const LABEL_1 = 'Test Doctor 001 (D-0001) · Test Specialization 001';
const LABEL_2 = 'Test Doctor 002 (D-0002) · Test Specialization 001';
const KEPT = ['patientId=5', 'status=SCHEDULED', 'from=2026-10-01', 'to=2026-10-31'];

function renderAt(url: string) {
  const fetchMock = vi.fn(async (input: string) => {
    const one = /^\/api\/doctors\/(\d+)/.exec(input);
    const body = one
      ? DOCTORS.find((d) => d.id === Number(one[1]))
      : input.startsWith('/api/doctors')
        ? { items: DOCTORS, page: 1, page_size: 20, total: 2 }
        : { items: [], page: 1, page_size: 20, total: 0 };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <MemoryRouter initialEntries={[url]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppointmentsPage />
    </MemoryRouter>,
  );
  return fetchMock;
}

const calls = (m: ReturnType<typeof renderAt>, prefix: string) =>
  m.mock.calls.map(([u]) => u as string).filter((u) => u.startsWith(prefix));
const lastList = (m: ReturnType<typeof renderAt>) => calls(m, '/api/appointments').at(-1)!;
const expectKept = (m: ReturnType<typeof renderAt>) => {
  for (const kept of KEPT) expect(lastList(m)).toContain(kept);
};

describe('AppointmentsPage doctor filter and status (HMS-8)', () => {
  it("HMS-8 REQ-1: a doctor filter from a link shows the doctor's name, not the id", async () => {
    renderAt('/appointments?doctorId=1');
    expect(await screen.findByText(LABEL_1)).toBeTruthy();
    expect(screen.queryByText('1', { exact: true })).toBeNull();
  });

  it('HMS-8 REQ-1, REQ-3: an Inactive doctor opened from a link shows its name', async () => {
    renderAt('/appointments?doctorId=2');
    expect(await screen.findByText(LABEL_2)).toBeTruthy();
    expect(screen.queryByText('2', { exact: true })).toBeNull();
  });

  it('HMS-8 REQ-2: the doctor chooser is shown with no doctor filter, and Clear All is hidden', async () => {
    renderAt('/appointments');
    expect(await screen.findByRole('textbox', { name: 'Search doctor' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear All' })).toBeNull();
  });

  it('HMS-8 REQ-3: the chooser offers Active and Inactive doctors and searches without a status', async () => {
    const fetchMock = renderAt('/appointments');
    expect(await screen.findByRole('button', { name: LABEL_1 })).toBeTruthy();
    expect(screen.getByRole('button', { name: LABEL_2 })).toBeTruthy();
    const searches = calls(fetchMock, '/api/doctors').filter((u) => !u.startsWith('/api/doctors/'));
    expect(searches.length).toBeGreaterThan(0);
    expect(searches.every((u) => !u.includes('status='))).toBe(true);
  });

  it('HMS-8 REQ-4, REQ-5, REQ-14: changing or clearing the doctor keeps patient, status and dates', async () => {
    const fetchMock = renderAt(`/appointments?doctorId=1&${KEPT.join('&')}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Change' }));
    await waitFor(() => expect(lastList(fetchMock)).not.toContain('doctorId='));
    expectKept(fetchMock);

    fireEvent.click(await screen.findByRole('button', { name: LABEL_2 }));
    await waitFor(() => expect(lastList(fetchMock)).toContain('doctorId=2'));
    expectKept(fetchMock);
    expect(await screen.findByText(LABEL_2)).toBeTruthy();
  });

  it('HMS-8 REQ-6: Clear All clears doctor, patient, status and dates', async () => {
    const fetchMock = renderAt(`/appointments?doctorId=1&${KEPT.join('&')}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Clear All' }));
    await waitFor(() => expect(lastList(fetchMock)).toBe('/api/appointments'));
    expect(screen.queryByRole('button', { name: 'Clear All' })).toBeNull();
  });

  it('HMS-8 REQ-6: Clear All also clears status and dates when no doctor or patient is set', async () => {
    const fetchMock = renderAt('/appointments?status=SCHEDULED&from=2026-10-01&to=2026-10-31');
    fireEvent.click(await screen.findByRole('button', { name: 'Clear All' }));
    await waitFor(() => expect(lastList(fetchMock)).toBe('/api/appointments'));
  });

  it('HMS-8 REQ-7, REQ-8: choosing Any except Cancelled sends status=NOT_CANCELLED', async () => {
    const fetchMock = renderAt('/appointments?doctorId=1');
    const select = await screen.findByRole('combobox', { name: 'Status' });
    expect(screen.getByRole('option', { name: 'Any except Cancelled' })).toBeTruthy();
    fireEvent.change(select, { target: { value: 'NOT_CANCELLED' } });
    await waitFor(() => expect(lastList(fetchMock)).toContain('status=NOT_CANCELLED'));
    expect(lastList(fetchMock)).toContain('doctorId=1');
  });

  it('HMS-8 REQ-8: a URL with status=NOT_CANCELLED opens with Any except Cancelled selected', async () => {
    renderAt('/appointments?status=NOT_CANCELLED');
    const select = (await screen.findByRole('combobox', { name: 'Status' })) as HTMLSelectElement;
    expect(select.value).toBe('NOT_CANCELLED');
  });
});
