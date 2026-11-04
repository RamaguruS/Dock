import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addDays, startOfDay, differenceInDays } from 'date-fns';
import { api } from '../../api';
import { DateStrip } from './DateStrip';
import { Chip } from '../ui';
import { DIRECTION_LABEL, TRAILER_LABEL, type DockDirection, type TrailerType, tzAbbrev } from '../../lib/format';

export interface SlotDetail {
  startTime: string;
  endTime: string;
  localTime: string;
  available: boolean;
  remainingCapacity: number;
  maxCapacity: number;
  reason?: 'FULL' | 'MAINTENANCE' | 'PAST';
  maintenanceReason?: string;
}

export interface DockAvailability {
  dockId: string;
  dockName: string;
  maxCapacityPerHour: number;
  direction: DockDirection;
  supportedTrailerTypes: TrailerType[];
  hazmatCertified: boolean;
  slots: SlotDetail[];
}

interface AvailabilityResponse {
  docks: DockAvailability[];
  closed: boolean;
  message?: string;
  timezone: string;
  slotDurationMinutes: number;
  bufferMinutes: number;
}

export interface PickedSlot {
  dockId: string;
  dockName: string;
  startTime: string;
  endTime: string;
  localTime: string;
  date: string;
}

export interface LoadFilter {
  direction: 'INBOUND' | 'OUTBOUND';
  trailerType: TrailerType;
  hazmat: boolean;
}

const MAX_FORWARD_DAYS = 30;

export const loadQueryString = (load: LoadFilter) =>
  `&direction=${load.direction}&trailerType=${load.trailerType}&hazmat=${load.hazmat}`;

export const SlotPicker: React.FC<{
  warehouseId: string;
  warehouseTimezone?: string;
  load: LoadFilter;
  selected: PickedSlot | null;
  onSelect: (slot: PickedSlot) => void;
  onJoinWaitlist?: (slot: PickedSlot) => void;
  /** Booking being rescheduled: its current slot is shown as "current" */
  currentStart?: string;
}> = ({ warehouseId, warehouseTimezone, load, selected, onSelect, onJoinWaitlist, currentStart }) => {
  const today = startOfDay(new Date());
  const [stripStart, setStripStart] = useState<Date>(today);
  const [selectedDate, setSelectedDate] = useState<string | null>(selected?.date ?? null);
  const loadQuery = loadQueryString(load);

  const { data, isLoading } = useQuery<AvailabilityResponse>({
    queryKey: ['availability', warehouseId, selectedDate, loadQuery],
    queryFn: async () =>
      (await api.get(`/api/bookings/availability?warehouseId=${warehouseId}&date=${selectedDate}${loadQuery}`)).data,
    enabled: !!warehouseId && !!selectedDate,
    refetchInterval: 15000,
  });

  const tz = data?.timezone ?? warehouseTimezone;

  return (
    <div className="space-y-4">
      <DateStrip
        warehouseId={warehouseId}
        stripStart={stripStart}
        selectedDate={selectedDate}
        onDateSelect={setSelectedDate}
        onPrev={() => setStripStart((d) => (differenceInDays(d, today) >= 7 ? addDays(d, -7) : today))}
        onNext={() => setStripStart((d) => addDays(d, 7))}
        canGoPrev={differenceInDays(stripStart, today) > 0}
        canGoNext={differenceInDays(addDays(stripStart, 7), today) < MAX_FORWARD_DAYS}
        loadQuery={loadQuery}
      />

      {!selectedDate ? (
        <p className="text-center py-8 text-sm text-slate-500 bg-slate-950/50 border border-slate-800 rounded-2xl">
          ← Select a date to see dock slots
        </p>
      ) : isLoading ? (
        <p className="text-center py-8 text-sm text-slate-500">Loading slots…</p>
      ) : data?.closed ? (
        <p className="text-center py-8 text-sm text-slate-400 bg-slate-950/50 border border-slate-800 rounded-2xl">
          🚫 {data.message}
        </p>
      ) : !data?.docks.length ? (
        <p className="text-center py-8 text-sm text-slate-400 bg-slate-950/50 border border-slate-800 rounded-2xl">
          {data?.message ?? 'No compatible docks'}
        </p>
      ) : (
        <div className="space-y-5">
          <p className="text-[11px] text-slate-500">
            Times shown in warehouse time ({tz ? tzAbbrev(tz) : ''}) · {data.slotDurationMinutes}-minute slots
            {data.bufferMinutes ? ` with ${data.bufferMinutes}-minute turnover buffer` : ''} · only docks that can handle a{' '}
            {TRAILER_LABEL[load.trailerType].toLowerCase()} {load.direction.toLowerCase()} load{load.hazmat ? ' with hazmat' : ''} are listed
          </p>
          {data.docks.map((dock) => (
            <div key={dock.dockId}>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <h3 className="text-xs font-black text-purple-400 uppercase tracking-wider">{dock.dockName}</h3>
                <Chip>{DIRECTION_LABEL[dock.direction]}</Chip>
                {dock.supportedTrailerTypes.map((t) => (
                  <Chip key={t}>{TRAILER_LABEL[t]}</Chip>
                ))}
                {dock.hazmatCertified && <Chip className="!bg-orange-950 !text-orange-300 !border-orange-700/50">Hazmat</Chip>}
                <Chip>{dock.maxCapacityPerHour} truck{dock.maxCapacityPerHour > 1 ? 's' : ''} / slot</Chip>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {dock.slots
                  .filter((s) => s.reason !== 'PAST')
                  .map((slot) => {
                    const picked: PickedSlot = {
                      dockId: dock.dockId,
                      dockName: dock.dockName,
                      startTime: slot.startTime,
                      endTime: slot.endTime,
                      localTime: slot.localTime,
                      date: selectedDate,
                    };
                    const isSelected = selected?.dockId === dock.dockId && selected?.startTime === slot.startTime;
                    const isCurrent = currentStart === slot.startTime;
                    const canWaitlist = slot.reason === 'FULL' && !!onJoinWaitlist && !isCurrent;

                    let style = 'bg-slate-900/80 border-slate-700/50 text-slate-200 hover:border-emerald-600/50 hover:text-emerald-400';
                    if (isSelected) style = 'bg-purple-600 border-purple-500 text-white shadow-lg shadow-purple-900/25';
                    else if (slot.reason === 'MAINTENANCE') style = 'bg-orange-950/30 border-orange-900/40 text-orange-400/70 cursor-not-allowed';
                    else if (slot.reason === 'FULL')
                      style = canWaitlist
                        ? 'bg-red-950/30 border-red-900/40 text-red-300/80 hover:border-amber-500/60 hover:text-amber-300'
                        : 'bg-red-950/30 border-red-900/30 text-red-500/50 cursor-not-allowed';

                    return (
                      <button
                        key={slot.startTime}
                        type="button"
                        disabled={!slot.available && !canWaitlist}
                        onClick={() => (slot.available ? onSelect(picked) : canWaitlist && onJoinWaitlist!(picked))}
                        title={slot.maintenanceReason ? `Maintenance: ${slot.maintenanceReason}` : undefined}
                        className={`p-2.5 rounded-xl text-center text-xs font-semibold border transition-all cursor-pointer flex flex-col items-center gap-1 ${style}`}
                      >
                        <span>{slot.localTime}</span>
                        <span className="text-[9px] font-bold leading-none">
                          {isCurrent
                            ? 'Current slot'
                            : slot.reason === 'MAINTENANCE'
                            ? 'Maintenance'
                            : slot.reason === 'FULL'
                            ? canWaitlist
                              ? 'Full · join waitlist'
                              : 'Full'
                            : `${slot.remainingCapacity}/${slot.maxCapacity} free`}
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
