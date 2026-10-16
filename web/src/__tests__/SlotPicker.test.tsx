import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Slot } from '../api/types';
import { SlotPicker } from '../components/SlotPicker';

const slot = (label: string, state: Slot['state']): Slot => ({ label, state, start: `2026-10-19T${label}:00+05:30`, end: '' });

describe('SlotPicker (APT-1)', () => {
  it('APT-1: only free slots can be chosen', () => {
    const onSelect = vi.fn();
    render(<SlotPicker slots={[slot('09:00', 'PAST'), slot('09:15', 'BOOKED'), slot('09:30', 'FREE')]} selected={undefined} onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: '09:00' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '09:15' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: '09:30' }));
    expect(onSelect).toHaveBeenCalledWith('2026-10-19T09:30:00+05:30');
  });

  it('says so when the doctor has no availability that day', () => {
    render(<SlotPicker slots={[]} selected={undefined} onSelect={() => undefined} />);
    expect(screen.getByText(/no availability/)).toBeTruthy();
  });
});
