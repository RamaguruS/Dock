import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
} from 'date-fns';
import { api } from '../../api';

export interface DaySummary {
  date: string; // 'YYYY-MM-DD'
  total: number;
  pending: number;
  approved: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  rejected: number;
}

interface Props {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const BookingCalendar: React.FC<Props> = ({ selectedDate, onSelectDate }) => {
  const [viewMonth, setViewMonth] = useState<Date>(startOfMonth(selectedDate));

  const monthParam = format(viewMonth, 'yyyy-MM');

  const { data: summary = [] } = useQuery<DaySummary[]>({
    queryKey: ['calendarSummary', monthParam],
    queryFn: async () => {
      const res = await api.get(`/api/bookings/calendar-summary?month=${monthParam}`);
      return res.data.summary;
    },
    staleTime: 30_000,
  });

  // Build lookup map date-string → summary
  const summaryMap: Record<string, DaySummary> = {};
  summary.forEach((s) => { summaryMap[s.date] = s; });

  // Grid: always starts Monday
  const monthStart = startOfMonth(viewMonth);
  const monthEnd   = endOfMonth(viewMonth);
  const gridStart  = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd    = endOfWeek(monthEnd,   { weekStartsOn: 1 });
  const days       = eachDayOfInterval({ start: gridStart, end: gridEnd });

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
      {/* Header row: prev / month label / next */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setViewMonth((m) => subMonths(m, 1))}
          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer"
          aria-label="Previous month"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <span className="text-sm font-bold text-slate-100">
          {format(viewMonth, 'MMMM yyyy')}
        </span>

        <button
          onClick={() => setViewMonth((m) => addMonths(m, 1))}
          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer"
          aria-label="Next month"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Weekday labels */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_LABELS.map((d) => (
          <div key={d} className="text-center text-[10px] font-bold text-slate-500 uppercase pb-1">
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-y-1">
        {days.map((day) => {
          const dateStr   = format(day, 'yyyy-MM-dd');
          const daySummary = summaryMap[dateStr];
          const inMonth   = isSameMonth(day, viewMonth);
          const isSelected = isSameDay(day, selectedDate);
          const isTodayCell = isToday(day);

          const badgeColor = daySummary
            ? daySummary.pending > 0
              ? 'bg-amber-500 text-slate-950'
              : 'bg-green-500 text-slate-950'
            : null;

          return (
            <button
              key={dateStr}
              onClick={() => {
                if (inMonth) {
                  onSelectDate(day);
                  // If we're looking at a month other than viewMonth when this cell was built
                  // (shouldn't happen), snap the view to the clicked day's month.
                }
              }}
              disabled={!inMonth}
              className={`
                relative flex flex-col items-center justify-start
                rounded-xl py-1.5 px-0.5 text-xs font-semibold
                transition-all duration-150 h-12 cursor-pointer
                ${!inMonth ? 'opacity-20 cursor-default' : ''}
                ${isSelected && inMonth
                    ? 'bg-purple-600 text-white shadow-md shadow-purple-900/30'
                    : isTodayCell && inMonth
                    ? 'ring-2 ring-purple-500/70 text-slate-100 bg-slate-800'
                    : inMonth
                    ? 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
                    : ''}
              `}
            >
              <span className="leading-none">{format(day, 'd')}</span>
              {daySummary && inMonth && (
                <span
                  className={`mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none ${badgeColor}`}
                >
                  {daySummary.total}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
