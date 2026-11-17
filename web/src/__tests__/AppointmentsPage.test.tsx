import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppointmentsPage } from '../pages/AppointmentsPage';

const EMPTY = { items: [], page: 1, page_size: 20, total: 0 };

/** Renders the page at `url` and returns the URLs the page fetched. */
function renderAt(url: string): string[] {
  const fetched: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    fetched.push(String(input));
    return new Response(JSON.stringify(EMPTY), { status: 200 });
  }));
  render(
    <MemoryRouter initialEntries={[url]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppointmentsPage />
    </MemoryRouter>,
  );
  return fetched;
}

describe('AppointmentsPage (HMS-21)', () => {
  it('HMS-21 REQ-6: passes started from the URL to the API with the status filter', async () => {
    const fetched = renderAt('/appointments?status=SCHEDULED&started=true');
    await screen.findByText(/0 appointment\(s\)/);
    const url = fetched[0] ?? '';
    expect(url).toContain('/api/appointments?');
    expect(url).toContain('status=SCHEDULED');
    expect(url).toContain('started=true');
  });

  it('HMS-21 REQ-6 edge: without started in the URL the API call carries no started filter', async () => {
    const fetched = renderAt('/appointments?status=SCHEDULED');
    await screen.findByText(/0 appointment\(s\)/);
    expect(fetched).toHaveLength(1);
    expect(fetched[0]).not.toContain('started');
  });
});
