import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { VisitSummary as Summary } from '../api/types';
import { VisitSummary } from '../components/VisitSummary';

const FULL: Summary = {
  completed: 4, noShow: 1, cancelled: 2, upcoming: 1,
  lastVisit: { appointmentId: 42, date: '2026-11-05', doctorName: 'Test Doctor 001' },
};

function renderSummary(summary: Summary, hasAppointments = true) {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <VisitSummary summary={summary} hasAppointments={hasAppointments} />
    </MemoryRouter>,
  );
  return screen.getByLabelText('Visit summary');
}

describe('VisitSummary (HMS-24)', () => {
  it('HMS-24 REQ-2..REQ-5, REQ-7: shows the four counts in the fixed format', () => {
    const box = renderSummary(FULL);
    expect(within(box).getByText('4 completed · 1 no-show · 2 cancelled · 1 upcoming')).toBeTruthy();
  });

  it('HMS-24 REQ-7 edge: zero counts are still shown', () => {
    const box = renderSummary({ ...FULL, completed: 3, noShow: 0, cancelled: 0 });
    expect(within(box).getByText('3 completed · 0 no-show · 0 cancelled · 1 upcoming')).toBeTruthy();
  });

  it('HMS-24 REQ-8..REQ-10: Last visit shows the date only, linked to the appointment, and the doctor as plain text', () => {
    const box = renderSummary(FULL);
    const links = within(box).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]!.textContent).toBe('05 Nov 2026');
    expect(links[0]!.getAttribute('href')).toBe('/appointments/42');
    const line = links[0]!.closest('p')!;
    expect(line.textContent).toBe('Last visit: 05 Nov 2026, Test Doctor 001');
    expect(line.textContent).not.toMatch(/\d{2}:\d{2}/);
  });

  it('HMS-24 REQ-11: no Completed appointment shows "Last visit: none yet"', () => {
    const box = renderSummary({ ...FULL, completed: 0, lastVisit: null });
    expect(within(box).getByText('Last visit: none yet')).toBeTruthy();
    expect(within(box).queryByRole('link')).toBeNull();
    expect(within(box).getByText('0 completed · 1 no-show · 2 cancelled · 1 upcoming')).toBeTruthy();
  });

  it('HMS-24 REQ-12: no appointments at all shows "No visits yet" instead of the counts and last visit', () => {
    const box = renderSummary({ completed: 0, noShow: 0, cancelled: 0, upcoming: 0, lastVisit: null }, false);
    expect(box.textContent).toBe('No visits yet');
  });

  it('HMS-24 REQ-12 edge: a patient with only a past, unclosed Scheduled appointment still sees the counts', () => {
    const box = renderSummary({ completed: 0, noShow: 0, cancelled: 0, upcoming: 0, lastVisit: null }, true);
    expect(within(box).getByText('0 completed · 0 no-show · 0 cancelled · 0 upcoming')).toBeTruthy();
    expect(within(box).queryByText('No visits yet')).toBeNull();
  });
});
