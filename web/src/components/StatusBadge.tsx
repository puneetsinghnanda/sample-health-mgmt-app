import type { AppointmentStatus, RecordStatus } from '../api/types';
import { STATUS_LABEL } from '../lib/format';

export function StatusBadge({ status }: { status: AppointmentStatus | RecordStatus }) {
  const label = status === 'ACTIVE' ? 'Active' : status === 'INACTIVE' ? 'Inactive' : STATUS_LABEL[status];
  return <span className={`badge badge-${status.toLowerCase()}`}>{label}</span>;
}
