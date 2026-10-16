import type { AvailabilityBlock } from '../api/types';
import { WEEKDAYS } from '../lib/format';

interface Props {
  blocks: AvailabilityBlock[];
  onChange: (blocks: AvailabilityBlock[]) => void;
  error?: string;
}

/** Weekly availability: blocks of weekday + start + end (PRD DOC fields). */
export function AvailabilityEditor({ blocks, onChange, error }: Props) {
  const set = (i: number, patch: Partial<AvailabilityBlock>) => onChange(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  return (
    <fieldset className="availability">
      <legend>Weekly availability</legend>
      {blocks.length === 0 && <p className="muted">No availability yet: the doctor cannot be booked.</p>}
      {blocks.map((b, i) => (
        <div className="row" key={i}>
          <select aria-label={`Block ${i + 1} weekday`} value={b.weekday} onChange={(e) => set(i, { weekday: Number(e.target.value) })}>
            {WEEKDAYS.map((name, d) => (
              <option key={name} value={d + 1}>
                {name}
              </option>
            ))}
          </select>
          <input aria-label={`Block ${i + 1} start`} type="time" value={b.start} onChange={(e) => set(i, { start: e.target.value })} />
          <span>to</span>
          <input aria-label={`Block ${i + 1} end`} type="time" value={b.end} onChange={(e) => set(i, { end: e.target.value })} />
          <button type="button" className="link" onClick={() => onChange(blocks.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...blocks, { weekday: 1, start: '09:00', end: '13:00' }])}>
        Add block
      </button>
      {error && <small className="field-error">{error}</small>}
    </fieldset>
  );
}
