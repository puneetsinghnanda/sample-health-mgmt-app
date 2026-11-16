import { describe, expect, it } from 'vitest';
import type { AppointmentDetail } from '../api/types';
import { bookAgainBlockers } from '../pages/AppointmentDetailPage';

const base = { doctor_status: 'ACTIVE', patient_status: 'ACTIVE' } as AppointmentDetail;

describe('Book again blockers (HMS-14)', () => {
  it('HMS-14 REQ-1/REQ-2: no blocker when doctor and patient are both ACTIVE', () => {
    expect(bookAgainBlockers(base)).toEqual([]);
  });

  it('HMS-14 REQ-9: an INACTIVE doctor says "Doctor is inactive"', () => {
    expect(bookAgainBlockers({ ...base, doctor_status: 'INACTIVE' })).toEqual(['Doctor is inactive']);
  });

  it('HMS-14 REQ-10: an INACTIVE patient says "Patient is inactive"', () => {
    expect(bookAgainBlockers({ ...base, patient_status: 'INACTIVE' })).toEqual(['Patient is inactive']);
  });

  it('HMS-14 REQ-11 (A-01): both INACTIVE show both reasons', () => {
    expect(bookAgainBlockers({ ...base, doctor_status: 'INACTIVE', patient_status: 'INACTIVE' })).toEqual([
      'Doctor is inactive',
      'Patient is inactive',
    ]);
  });
});
