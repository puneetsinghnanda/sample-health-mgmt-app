import type { Slot } from '../api/types';

interface Props {
  slots: Slot[];
  selected: string | undefined;
  onSelect: (start: string) => void;
}

/** APT-1: only free slots can be chosen; booked and past ones are shown but disabled. */
export function SlotPicker({ slots, selected, onSelect }: Props) {
  if (slots.length === 0) return <p className="muted">The doctor has no availability on this day.</p>;
  return (
    <div className="slots" role="group" aria-label="Time slots">
      {slots.map((s) => (
        <button
          type="button"
          key={s.start}
          className={`slot slot-${s.state.toLowerCase()}${selected === s.start ? ' slot-selected' : ''}`}
          disabled={s.state !== 'FREE'}
          aria-pressed={selected === s.start}
          title={s.state === 'BOOKED' ? 'Booked' : s.state === 'PAST' ? 'In the past' : 'Free'}
          onClick={() => onSelect(s.start)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
