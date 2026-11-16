import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookAppointmentPage } from '../pages/BookAppointmentPage';

function renderPage(state?: unknown) {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/appointments/new', state }]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/appointments/new" element={<BookAppointmentPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const reasonInput = () => screen.getByLabelText('Reason for visit') as HTMLInputElement;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('BookAppointmentPage reason from Book again (HMS-14)', () => {
  it('HMS-14 REQ-6 (S-3 AC1): the reason in navigation state fills the reason for visit', () => {
    renderPage({ reason: 'Follow-up' });
    expect(reasonInput().value).toBe('Follow-up');
  });

  it('HMS-14 REQ-15 (S-3 AC4): the filled reason can still be edited', () => {
    renderPage({ reason: 'Follow-up' });
    fireEvent.change(reasonInput(), { target: { value: 'Review results' } });
    expect(reasonInput().value).toBe('Review results');
  });

  it('HMS-14 REQ-16 (S-3 AC5): a 301st character in state is cut at the 300-character limit, which the field keeps', () => {
    renderPage({ reason: 'x'.repeat(301) });
    expect(reasonInput().value).toHaveLength(300);
    expect(reasonInput().maxLength).toBe(300);
  });

  it('HMS-14 REQ-18/REQ-17 (S-6 AC3): without navigation state the reason starts empty, as today', () => {
    renderPage();
    expect(reasonInput().value).toBe('');
  });

  it('HMS-14 REQ-17 edge: a reason in state that is not text is ignored', () => {
    renderPage({ reason: 42 });
    expect(reasonInput().value).toBe('');
  });

  it('HMS-14 REQ-7 (S-2 AC2): at 00:30 Asia/Kolkata on 17 November (19:00 UTC on 16 November) the date is 17 November', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T19:00:00Z'));
    renderPage({ reason: 'Follow-up' });
    expect((screen.getByLabelText(/^Date/) as HTMLInputElement).value).toBe('2026-11-17');
  });
});
