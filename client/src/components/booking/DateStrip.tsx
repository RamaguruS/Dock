import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { addDays, format, parseISO } from 'date-fns';
import { api } from '../../api';

export interface DaySummary {
  date: string;        // 'YYYY-MM-DD'
  dayOfWeek: string;   // 'Monday'
  dayAbbrev: string;   // 'MON'
  isOpen: boolean;
  totalSlots: number;
  freeSlots: number;
  fullyBooked: boolean;
}

interface Props {
  warehouseId: string;
  /** ISO string of the first day displayed in this strip (always today or later) */
  stripStart: Date;
  selectedDate: string | null;   // 'YYYY-MM-DD'
  onDateSelect: (date: string) => void;
  onPrev: () => void;
  onNext: () => void;
  canGoPrev: boolean;
  canGoNext: boolean;
}

const DAYS = 7;

/** Skeleton card shown while data loads */
const SkeletonCard = () => (
  <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0 rounded-2xl px-1 py-3 bg-slate-800/40 animate-pulse">
    <div className="h-2.5 w-6 bg-slate-700 rounded" />
    <div className="h-8 w-8 bg-slate-700 rounded-xl" />
    <div className="h-2 w-5 bg-slate-700 rounded" />
  </div>
);

export const DateStrip: React.FC<Props> = ({
  warehouseId,
  stripStart,
  selectedDate,
  onDateSelect,
  onPrev,
  onNext,
  canGoPrev,
  canGoNext,
}) => {
  const startDateStr = format(stripStart, 'yyyy-MM-dd');

  const { data: summaryData, isLoading } = useQuery<DaySummary[]>({
    queryKey: ['availability-summary', warehouseId, startDateStr],
    queryFn: async () => {
      const res = await api.get(
        `/api/bookings/availability-summary?warehouseId=${warehouseId}&startDate=${startDateStr}&days=${DAYS}`
      );
      return res.data.summary;
    },
    staleTime: 60_000,
    enabled: !!warehouseId,
  });

  // Build a lookup by date string
  const summaryMap: Record<string, DaySummary> = {};
  (summaryData ?? []).forEach((d) => { summaryMap[d.date] = d; });

  // Generate the 7 date strings for this strip
  const dates = Array.from({ length: DAYS }, (_, i) =>
    format(addDays(stripStart, i), 'yyyy-MM-dd')
  );

  return (
    <div className="space-y-3">
      {/* Strip header */}
      <div className="flex items-center gap-2">
        <button
          onClick={onPrev}
          disabled={!canGoPrev}
          aria-label="Previous week"
          className={`p-1.5 rounded-lg transition-all cursor-pointer
            ${canGoPrev
              ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              : 'bg-slate-900 text-slate-700 cursor-not-allowed'}`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Day cards */}
        <div className="flex gap-1.5 flex-1 overflow-hidden">
          {isLoading
            ? dates.map((d) => <SkeletonCard key={d} />)
            : dates.map((dateStr) => {
                const info = summaryMap[dateStr];
                const day = parseISO(dateStr);
                const isSelected = dateStr === selectedDate;
                const isToday = dateStr === format(new Date(), 'yyyy-MM-dd');

                // Determine visual state
                const isClosed    = info && !info.isOpen;
                const isFull      = info?.fullyBooked;
                const hasSlots    = info && info.isOpen && info.freeSlots > 0;
                const noInfoYet   = !info;

                // Dot color
                let dotColor = '';
                if (isClosed || noInfoYet)     dotColor = '';
                else if (isFull)               dotColor = 'bg-red-500';
                else if (hasSlots)             dotColor = 'bg-emerald-400';

                // Card bg
                let cardClass = '';
                if (isSelected) {
                  cardClass = 'bg-purple-600 border-purple-500 shadow-lg shadow-purple-900/30 text-white';
                } else if (isClosed) {
                  cardClass = 'bg-slate-900/50 border-slate-800/40 text-slate-600 cursor-not-allowed opacity-60';
                } else if (isToday) {
                  cardClass = 'bg-slate-800 border-purple-500/60 ring-1 ring-purple-500/40 text-slate-100 hover:bg-slate-700';
                } else {
                  cardClass = 'bg-slate-800/60 border-slate-700/40 text-slate-300 hover:bg-slate-700/70 hover:text-slate-100';
                }

                return (
                  <button
                    key={dateStr}
                    onClick={() => !isClosed && onDateSelect(dateStr)}
                    disabled={isClosed}
                    title={
                      isClosed   ? 'Warehouse closed'
                      : isFull   ? `Fully booked (${info.totalSlots} slots)`
                      : info     ? `${info.freeSlots} of ${info.totalSlots} slots free`
                      : dateStr
                    }
                    className={`
                      relative flex flex-col items-center justify-between
                      flex-1 min-w-0 rounded-2xl px-1 py-3 border
                      transition-all duration-150 cursor-pointer select-none
                      ${cardClass}
                    `}
                  >
                    {/* Day abbreviation */}
                    <span className="text-[9px] font-black uppercase tracking-widest leading-none opacity-70">
                      {format(day, 'EEE')}
                    </span>

                    {/* Date number */}
                    <span className="text-lg font-black leading-none mt-1">
                      {format(day, 'd')}
                    </span>

                    {/* Availability dot */}
                    <span className="mt-1.5 h-1.5 w-1.5">
                      {dotColor && (
                        <span className={`block w-1.5 h-1.5 rounded-full ${dotColor}`} />
                      )}
                    </span>
                  </button>
                );
              })}
        </div>

        <button
          onClick={onNext}
          disabled={!canGoNext}
          aria-label="Next week"
          className={`p-1.5 rounded-lg transition-all cursor-pointer
            ${canGoNext
              ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              : 'bg-slate-900 text-slate-700 cursor-not-allowed'}`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-slate-500 font-medium px-1">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
          Available
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
          Fully booked
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-600 inline-block" />
          Closed
        </span>
      </div>
    </div>
  );
};
