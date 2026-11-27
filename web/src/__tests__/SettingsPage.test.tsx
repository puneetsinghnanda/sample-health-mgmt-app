import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { DoctorListRow, Page, RefEntry } from '../api/types';
import { DoctorsPage } from '../pages/DoctorsPage';
import { SettingsPage } from '../pages/SettingsPage';

const DEPARTMENTS: RefEntry[] = [
  { id: 1, name: 'Cardiology', status: 'ACTIVE', doctorCount: 3 },
  { id: 2, name: 'Test Department 002', status: 'INACTIVE', doctorCount: 3 },
  { id: 3, name: 'Test Department 003', status: 'ACTIVE', doctorCount: 0 },
  { id: 4, name: 'Test Department 004', status: 'ACTIVE', doctorCount: 1 },
];

const SPECIALIZATIONS: RefEntry[] = [
  { id: 11, name: 'Test Specialization 011', status: 'ACTIVE', doctorCount: 3 },
  { id: 12, name: 'Test Specialization 012', status: 'INACTIVE', doctorCount: 0 },
  { id: 13, name: 'Test Specialization 013', status: 'INACTIVE', doctorCount: 3 },
  { id: 14, name: 'Test Specialization 014', status: 'ACTIVE', doctorCount: 0 },
];

const BASE = {
  specialization: { id: 11, name: 'Test Specialization 011', status: 'ACTIVE' as const },
  department: { id: 1, name: 'Cardiology', status: 'ACTIVE' as const },
  phone: '+91 00000 00000', email: null, feePaise: 50000, slotMinutes: 15, today_count: 0,
};

const DOCTORS: Page<DoctorListRow> = {
  items: [
    { ...BASE, id: 1, code: 'D-0001', fullName: 'Test Doctor 001', status: 'ACTIVE' },
    { ...BASE, id: 2, code: 'D-0002', fullName: 'Test Doctor 002', status: 'ACTIVE' },
    { ...BASE, id: 3, code: 'D-0003', fullName: 'Test Doctor 003', status: 'INACTIVE' },
  ],
  page: 1,
  page_size: 20,
  total: 3,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function stubApi(overrides: { departments?: () => Response } = {}) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith('/api/departments')) return overrides.departments ? overrides.departments() : json({ items: DEPARTMENTS });
    if (url.startsWith('/api/specializations')) return json({ items: SPECIALIZATIONS });
    if (url.startsWith('/api/doctors')) return json(DOCTORS);
    return json({ items: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/doctors" element={<DoctorsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function row(name: string): Promise<HTMLElement> {
  return (await screen.findByText(name)).closest('tr')!;
}

async function doctorsCell(name: string): Promise<HTMLElement> {
  return within(await row(name)).getAllByRole('cell')[1]!;
}

function doctorCalls(fetchMock: ReturnType<typeof stubApi>): string[] {
  return fetchMock.mock.calls.map(([url]) => url).filter((url) => url.startsWith('/api/doctors'));
}

function select(label: string): HTMLSelectElement {
  return screen.getByLabelText(label) as HTMLSelectElement;
}

function shown(label: string): string | null {
  const s = select(label);
  return s.options[s.selectedIndex]?.textContent ?? null;
}

describe('SettingsPage Doctors count link (HMS-29)', () => {
  it('HMS-29 REQ-1, REQ-3: a department count links to the doctor list filtered by departmentId, with no status', async () => {
    stubApi();
    renderAt('/settings');
    const link = within(await doctorsCell('Cardiology')).getByRole('link');
    expect(link.textContent).toBe('3');
    expect(link.getAttribute('href')).toBe('/doctors?departmentId=1');
    expect(link.getAttribute('href')).not.toContain('status');
  });

  it('HMS-29 REQ-2, REQ-3: a specialization count links to the doctor list filtered by specializationId, with no status', async () => {
    stubApi();
    renderAt('/settings');
    const link = within(await doctorsCell('Test Specialization 011')).getByRole('link');
    expect(link.textContent).toBe('3');
    expect(link.getAttribute('href')).toBe('/doctors?specializationId=11');
    expect(link.getAttribute('href')).not.toContain('status');
  });

  it('HMS-29 REQ-4 edge (S-1 AC3, S-2 AC3): a count of 0 is plain text, not a link, for both kinds', async () => {
    stubApi();
    renderAt('/settings');
    const department = await doctorsCell('Test Department 003');
    expect(department.textContent).toBe('0');
    expect(within(department).queryByRole('link')).toBeNull();
    const specialization = await doctorsCell('Test Specialization 014');
    expect(specialization.textContent).toBe('0');
    expect(within(specialization).queryByRole('link')).toBeNull();
  });

  it('HMS-29 REQ-5 (S-1 AC4, S-2 AC4): an Inactive entry links the same way as an Active one', async () => {
    stubApi();
    renderAt('/settings');
    const department = within(await doctorsCell('Test Department 002')).getByRole('link');
    expect(department.getAttribute('href')).toBe('/doctors?departmentId=2');
    expect(department.getAttribute('aria-label')).toBe('3 doctors in Test Department 002');
    const specialization = within(await doctorsCell('Test Specialization 013')).getByRole('link');
    expect(specialization.getAttribute('href')).toBe('/doctors?specializationId=13');
    expect(specialization.getAttribute('aria-label')).toBe('3 doctors in Test Specialization 013');
  });

  it('HMS-29 REQ-6 (S-3 AC1, AC2): the accessible name reads "<n> doctors in <name>" for both kinds', async () => {
    stubApi();
    renderAt('/settings');
    await screen.findByText('Cardiology');
    expect(screen.getByRole('link', { name: '3 doctors in Cardiology' }).textContent).toBe('3');
    expect(screen.getByRole('link', { name: '3 doctors in Test Specialization 011' }).textContent).toBe('3');
  });

  it('HMS-29 REQ-6 edge (S-3 AC3): a count of 1 reads "1 doctor in <name>", singular', async () => {
    stubApi();
    renderAt('/settings');
    const link = within(await doctorsCell('Test Department 004')).getByRole('link');
    expect(link.getAttribute('aria-label')).toBe('1 doctor in Test Department 004');
    expect(link.getAttribute('href')).toBe('/doctors?departmentId=4');
  });

  it('HMS-29 REQ-7 (S-4 AC1): an Active entry in use keeps name, status, Rename and Deactivate, and no Delete', async () => {
    stubApi();
    renderAt('/settings');
    const r = within(await row('Cardiology'));
    expect(r.getByText('Active')).toBeTruthy();
    expect(r.getByRole('button', { name: 'Rename' })).toBeTruthy();
    expect(r.getByRole('button', { name: 'Deactivate' })).toBeTruthy();
    expect(r.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('HMS-29 REQ-7 (S-4 AC2): an unused Inactive entry keeps Rename, Activate and Delete, and the add form is unchanged', async () => {
    stubApi();
    renderAt('/settings');
    const r = within(await row('Test Specialization 012'));
    expect(r.getByText('Inactive')).toBeTruthy();
    expect(r.getByRole('button', { name: 'Rename' })).toBeTruthy();
    expect(r.getByRole('button', { name: 'Activate' })).toBeTruthy();
    expect(r.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(screen.getByLabelText('New specialization name')).toBeTruthy();
    expect(screen.getByLabelText('New department name')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Add' })).toHaveLength(2);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Name', 'Doctors', 'Status', 'Actions', 'Name', 'Doctors', 'Status', 'Actions']);
  });

  it('HMS-29 REQ-1 error: a failed department list renders no count links and leaves the specializations table working', async () => {
    const fetchMock = stubApi({ departments: () => json({ error: { message: 'Test failure 001' } }, 500) });
    renderAt('/settings');
    await screen.findByText('Test Specialization 011');
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/departments'))).toBe(true));
    const [departments] = screen.getAllByRole('table');
    expect(within(departments!).queryAllByRole('link')).toHaveLength(0);
    expect(within(departments!).queryByText('Cardiology')).toBeNull();
    expect(screen.getByRole('link', { name: '3 doctors in Test Specialization 011' })).toBeTruthy();
  });
});

describe('Settings count link opens the doctor list (HMS-29)', () => {
  it('HMS-29 REQ-1, REQ-3 (S-1 AC1, AC2): the department link opens the list on that department at "Any status"', async () => {
    const fetchMock = stubApi();
    renderAt('/settings');
    fireEvent.click(await screen.findByRole('link', { name: '3 doctors in Cardiology' }));
    expect(await screen.findByRole('heading', { name: 'Doctors' })).toBeTruthy();
    await screen.findByText('Test Doctor 003');
    const call = doctorCalls(fetchMock).at(-1)!;
    expect(call).toContain('departmentId=1');
    expect(call).not.toContain('specializationId');
    expect(call).not.toContain('status=');
    await waitFor(() => expect(select('Department').value).toBe('1'));
    expect(shown('Department')).toBe('Cardiology');
    expect(select('Status').value).toBe('');
    expect(shown('Status')).toBe('Any status');
    expect(screen.getAllByRole('link', { name: /^Test Doctor 00\d$/ })).toHaveLength(3);
    expect(within(await row('Test Doctor 003')).getByText('Inactive')).toBeTruthy();
  });

  it('HMS-29 REQ-2, REQ-3 (S-2 AC1, AC2): the specialization link opens the list on that specialization at "Any status"', async () => {
    const fetchMock = stubApi();
    renderAt('/settings');
    fireEvent.click(await screen.findByRole('link', { name: '3 doctors in Test Specialization 011' }));
    await screen.findByText('Test Doctor 001');
    const call = doctorCalls(fetchMock).at(-1)!;
    expect(call).toContain('specializationId=11');
    expect(call).not.toContain('departmentId');
    expect(call).not.toContain('status=');
    await waitFor(() => expect(select('Specialization').value).toBe('11'));
    expect(select('Department').value).toBe('');
    expect(select('Status').value).toBe('');
  });

  it('HMS-29 REQ-8 (S-4 AC3): the doctor list opened directly shows every filter at its "All" value', async () => {
    const fetchMock = stubApi();
    renderAt('/doctors');
    await screen.findByText('Test Doctor 001');
    const call = doctorCalls(fetchMock).at(-1)!;
    expect(call).not.toContain('departmentId');
    expect(call).not.toContain('specializationId');
    expect(call).not.toContain('status=');
    expect(shown('Department')).toBe('All departments');
    expect(shown('Specialization')).toBe('All specializations');
    expect(shown('Status')).toBe('Any status');
  });

  it('HMS-29 REQ-8 edge (S-4 AC4): after the link, choosing "All departments" clears the department filter', async () => {
    const fetchMock = stubApi();
    renderAt('/settings');
    fireEvent.click(await screen.findByRole('link', { name: '3 doctors in Cardiology' }));
    await screen.findByText('Test Doctor 001');
    await waitFor(() => expect(select('Department').value).toBe('1'));
    const before = doctorCalls(fetchMock).length;
    fireEvent.change(select('Department'), { target: { value: '' } });
    await waitFor(() => expect(doctorCalls(fetchMock).length).toBeGreaterThan(before));
    expect(doctorCalls(fetchMock).at(-1)!).not.toContain('departmentId');
    expect(select('Department').value).toBe('');
  });
});
