import React from 'react';

export type BookingStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REJECTED';

export const STATUS_STYLES: Record<BookingStatus, string> = {
  PENDING:     'bg-amber-950  text-amber-400  border-amber-500/20',
  APPROVED:    'bg-green-950  text-green-400  border-green-500/20',
  IN_PROGRESS: 'bg-blue-950   text-blue-400   border-blue-500/20  animate-pulse',
  COMPLETED:   'bg-teal-950   text-teal-400   border-teal-500/20',
  CANCELLED:   'bg-slate-900  text-slate-500  border-slate-700/20',
  REJECTED:    'bg-red-950    text-red-400    border-red-500/20',
};

interface Props {
  status: BookingStatus;
}

export const BookingStatusBadge: React.FC<Props> = ({ status }) => (
  <span
    className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${STATUS_STYLES[status] ?? ''}`}
  >
    {status.replace('_', ' ')}
  </span>
);
