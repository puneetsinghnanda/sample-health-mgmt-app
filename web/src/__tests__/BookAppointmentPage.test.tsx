import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { DaySchedule, DoctorDetail, PatientDetail, Slot } from '../api/types';
import { BookAppointmentPage } from '../pages/BookAppointmentPage';

function doctor(id: number, feePaise: number): DoctorDetail {
  return {
    id, code: `D-000${id}`, fullName: `Test Doctor 00${id}`,
    specialization: { id: 1, name: 'Test Specialization 001', status: 'ACTIVE' },
    department: { id: 1, name: 'Test Department 001', status: 'ACTIVE' },
    phone: `+91 00000 0000${id}`, email: `doctor${id}@example.com`, feePaise, slotMinutes: 15, status: 'ACTIVE',
    availability: [], upcoming: [], outsideAvailability: [], appointmentCount: 0,
    noShowsLast30Days: 0, noShowsWindow: { from: '2026-10-22', to: '2026-11-20' }, nextSevenDays: null,
  };
}

const PATIENT: PatientDetail = {
  id: 1, code: 'P-000001', fullName: 'Test Patient 001', dateOfBirth: '1990-01-01', age: 36, gender: 'OTHER',
  phone: '+91 00000 00099', status: 'ACTIVE', registeredAt: '2026-01-01T00:00:00Z',
  email: 'patient001@example.com', address: null, emergencyContact: { name: null, phone: null },
  medicalHistory: { bloodGroup: 'O+', allergies: ['Test Allergy 001'], chronicConditions: [], currentMedications: [], notes: null },
  appointments: [],
};

const FREE: Slot = { start: '2026-12-01T04:30:00.000Z', end: '2026-12-01T04:45:00.000Z', label: '10:00', state: 'FREE' };
const BOOKED: Slot = { start: '2026-12-01T04:45:00.000Z', end: '2026-12-01T05:00:00.000Z', label: '10:15', state: 'BOOKED' };
const PAST: Slot = { start: '2026-12-01T04:15:00.000Z', end: '2026-12-01T04:30:00.000Z', label: '09:45', state: 'PAST' };

interface Setup {
  doctors: DoctorDetail[];
  /** Doctor ids whose GET /api/doctors/:id fails with 500. */
  failing?: number[];
  /** Doctor ids whose GET /api/doctors/:id never answers until released. */
  held?: Record<number, Promise<void>>;
  slots?: Slot[];
}

function renderPage(setup: Setup, path = '/appointments/new') {
  const posts: unknown[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: { method?: string; body?: string }) => {
    const url = new URL(input, 'http://test');
    const parts = url.pathname.split('/').filter(Boolean); // ['api', 'doctors', '1', 'slots']
    if (init?.method === 'POST' && url.pathname === '/api/appointments') {
      posts.push(JSON.parse(init.body ?? '{}'));
      return json({ id: 99 }, 201);
    }
    if (parts[1] === 'doctors' && parts.length === 2) {
      return json({ items: setup.doctors, page: 1, page_size: 20, total: setup.doctors.length });
    }
    if (parts[1] === 'doctors' && parts[3] === 'slots') {
      const day: DaySchedule = { doctorId: Number(parts[2]), date: url.searchParams.get('date') ?? '', slotMinutes: 15, slots: setup.slots ?? [FREE], appointments: [] };
      return json(day);
    }
    if (parts[1] === 'doctors' && parts.length === 3) {
      const id = Number(parts[2]);
      if (setup.held?.[id]) await setup.held[id];
      if (setup.failing?.includes(id)) return json({ error: { code: 'INTERNAL', message: 'Test failure' } }, 500);
      return json(setup.doctors.find((d) => d.id === id));
    }
    if (parts[1] === 'patients' && parts.length === 2) return json({ items: [PATIENT], page: 1, page_size: 20, total: 1 });
    if (parts[1] === 'patients' && parts.length === 3) return json(PATIENT);
    return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }));
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/appointments/new" element={<BookAppointmentPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return { posts };
}

async function chooseDoctor(d: DoctorDetail) {
  fireEvent.click(await screen.findByRole('button', { name: `${d.fullName} (${d.code}) · ${d.specialization.name}` }));
}

async function changeDoctor(d: DoctorDetail) {
  const doctorBox = screen.getByRole('group', { name: 'Doctor' });
  fireEvent.click(within(doctorBox).getByRole('button', { name: 'Change' }));
  await chooseDoctor(d);
}

async function choosePatient() {
  fireEvent.click(await screen.findByRole('button', { name: `${PATIENT.fullName} (${PATIENT.code})` }));
}

/** The <dd> next to the "Consultation fee" term. */
async function feeCell(): Promise<HTMLElement> {
  const term = await screen.findByText('Consultation fee');
  return term.nextElementSibling as HTMLElement;
}

const A = doctor(1, 150000);
const B = doctor(2, 50000);

describe('BookAppointmentPage consultation fee (HMS-32)', () => {
  it('HMS-32 REQ-1/REQ-2 (S-1 AC1): choosing a doctor shows "Consultation fee" ₹1,500.00 in a details list', async () => {
    renderPage({ doctors: [A] });
    await chooseDoctor(A);
    const term = await screen.findByText('Consultation fee');
    expect(term.tagName).toBe('DT');
    expect(term.closest('dl')?.classList.contains('details')).toBe(true);
    expect((await feeCell()).textContent).toBe('₹1,500.00');
  });

  it('HMS-32 REQ-4 (S-1 AC2): before a doctor is chosen no fee and no label are shown', async () => {
    renderPage({ doctors: [A] });
    await screen.findByRole('button', { name: `${A.fullName} (${A.code}) · ${A.specialization.name}` });
    expect(screen.queryByText('Consultation fee')).toBeNull();
    expect(screen.queryByText(/₹/)).toBeNull();
  });

  it('HMS-32 REQ-5 (S-1 AC3) edge: a fee of 0 paise shows ₹0.00', async () => {
    const free = doctor(3, 0);
    renderPage({ doctors: [free] });
    await chooseDoctor(free);
    expect((await feeCell()).textContent).toBe('₹0.00');
  });

  it('HMS-32 REQ-10 (S-1 AC4): a doctor filled in from the URL shows its fee without picking', async () => {
    renderPage({ doctors: [A] }, '/appointments/new?doctorId=1');
    expect((await feeCell()).textContent).toBe('₹1,500.00');
  });

  it('HMS-32 REQ-2 (S-1 AC5) edge: 10000000 paise uses Indian digit grouping, ₹1,00,000.00', async () => {
    const big = doctor(4, 10000000);
    renderPage({ doctors: [big] });
    await chooseDoctor(big);
    const text = (await feeCell()).textContent;
    expect(text).toBe('₹1,00,000.00');
    expect(text).not.toBe('₹100,000.00');
  });

  it('HMS-32 REQ-3 (S-2 AC1): choosing another doctor replaces the fee without a reload', async () => {
    renderPage({ doctors: [A, B] });
    await chooseDoctor(A);
    expect((await feeCell()).textContent).toBe('₹1,500.00');
    await changeDoctor(B);
    await waitFor(async () => expect((await feeCell()).textContent).toBe('₹500.00'));
    expect(screen.queryByText('₹1,500.00')).toBeNull();
  });

  it('HMS-32 REQ-9 (S-2 AC2) error: a fee that cannot be loaded shows no fee and booking still works', async () => {
    const { posts } = renderPage({ doctors: [A], failing: [1] });
    await chooseDoctor(A);
    await choosePatient();
    fireEvent.click(await screen.findByRole('button', { name: FREE.label }));
    expect(screen.queryByText('Consultation fee')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Book' }));
    await waitFor(() => expect(posts).toHaveLength(1));
  });

  it("HMS-32 REQ-3/REQ-9 (S-2 AC3) edge: the previous doctor's fee never stays while the next one loads or fails", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    renderPage({ doctors: [A, B], failing: [2], held: { 2: held } });
    await chooseDoctor(A);
    expect((await feeCell()).textContent).toBe('₹1,500.00');
    await changeDoctor(B);
    // B's fee is still loading: A's fee must already be gone.
    expect(screen.queryByText('₹1,500.00')).toBeNull();
    expect(screen.queryByText('Consultation fee')).toBeNull();
    // Let B's (failing) answer arrive and settle.
    await act(async () => {
      release();
      await held;
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByText('₹1,500.00')).toBeNull();
    expect(screen.queryByText('Consultation fee')).toBeNull();
  });

  it('HMS-32 REQ-6 (S-3 AC1): the fee is plain text, with no input to change it', async () => {
    renderPage({ doctors: [A] });
    await chooseDoctor(A);
    const list = (await screen.findByText('Consultation fee')).closest('dl') as HTMLElement;
    expect(within(list).queryByRole('textbox')).toBeNull();
    expect(within(list).queryByRole('spinbutton')).toBeNull();
    expect(list.querySelector('input, select, textarea')).toBeNull();
  });

  it('HMS-32 REQ-7 (S-3 AC2): the booking request is unchanged and carries no fee', async () => {
    const { posts } = renderPage({ doctors: [A] });
    await chooseDoctor(A);
    await feeCell();
    await choosePatient();
    fireEvent.click(await screen.findByRole('button', { name: FREE.label }));
    fireEvent.change(screen.getByLabelText(/Reason for visit/), { target: { value: 'Test reason 001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Book' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ doctorId: 1, patientId: 1, startsAt: FREE.start, reason: 'Test reason 001' });
  });

  it('HMS-32 REQ-8/REQ-11 (S-3 AC3/AC4, S-4 AC1): with the fee shown, only free slots can be chosen; booked and past stay disabled', async () => {
    renderPage({ doctors: [A], slots: [PAST, FREE, BOOKED] });
    await chooseDoctor(A);
    await feeCell();
    const slots = await screen.findByRole('group', { name: 'Time slots' });
    expect(within(slots).getAllByRole('button').map((b) => b.textContent)).toEqual(['09:45', '10:00', '10:15']);
    expect((within(slots).getByRole('button', { name: '10:00' }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(slots).getByRole('button', { name: '10:15' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(slots).getByRole('button', { name: '09:45' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('HMS-32 REQ-8/REQ-11 (S-3 AC5, S-4 AC2) edge: a day without availability still shows no free slot, with the fee shown', async () => {
    renderPage({ doctors: [A], slots: [] });
    await chooseDoctor(A);
    await feeCell();
    expect(await screen.findByText('The doctor has no availability on this day.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Time slots' })).toBeNull();
  });

  it('HMS-32 REQ-12 (S-4 AC3): the other fields and buttons are still there with the fee shown', async () => {
    renderPage({ doctors: [A] });
    await chooseDoctor(A);
    await feeCell();
    for (const name of ['Doctor', 'Patient', 'Time']) expect(screen.getByRole('group', { name })).toBeTruthy();
    expect(screen.getByLabelText(/Date/)).toBeTruthy();
    expect(screen.getByLabelText(/Reason for visit/)).toBeTruthy();
    for (const name of ['Book', 'Cancel']) expect(screen.getByRole('button', { name })).toBeTruthy();
  });

  it("HMS-32 REQ-13/REQ-14 (S-4 AC4/AC5): no medical history and no contact details appear with the fee", async () => {
    renderPage({ doctors: [A] }, '/appointments/new?doctorId=1&patientId=1');
    expect((await feeCell()).textContent).toBe('₹1,500.00');
    await screen.findByText(`${PATIENT.fullName} (${PATIENT.code})`);
    const text = document.body.textContent ?? '';
    for (const hidden of ['Test Allergy 001', 'O+', PATIENT.phone, PATIENT.email!, A.phone, A.email!]) {
      expect(text).not.toContain(hidden);
    }
  });
});
