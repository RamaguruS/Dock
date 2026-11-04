import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, startOfDay } from 'date-fns';
import { api } from '../../../api';
import { BookingCalendar } from '../../../components/dashboard/BookingCalendar';
import { BookingStatusBadge } from '../../../components/BookingStatusBadge';
import { RescheduleModal } from '../../../components/booking/RescheduleModal';
import { Button, Card, Chip, Empty, Stat, inputClass } from '../../../components/ui';
import {
  type Booking,
  type BookingStatus,
  STATUS_LABEL,
  TRAILER_LABEL,
  errorMessage,
  fmtDate,
  fmtTime,
  localDateKey,
  minutes,
} from '../../../lib/format';
import { exportBookingsCsv, exportBookingsPdf } from '../../../lib/export';
import { type Notify, type Warehouse } from '../types';

const ACTIVE: BookingStatus[] = ['PENDING', 'APPROVED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW'];

export const YardTab: React.FC<{ warehouse: Warehouse; notify: Notify }> = ({ warehouse, notify }) => {
  const queryClient = useQueryClient();
  const tz = warehouse.timezone;
  const [selectedDate, setSelectedDate] = useState<Date>(startOfDay(new Date()));
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [dockFilter, setDockFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [rescheduling, setRescheduling] = useState<Booking | null>(null);
  const dateKey = format(selectedDate, 'yyyy-MM-dd');

  const { data: raw = [], isLoading, refetch, isFetching } = useQuery<Booking[]>({
    queryKey: ['bookings', dateKey],
    queryFn: async () => {
      // Wide UTC window, then keep the bookings whose start falls on this site-local date
      const base = new Date(`${dateKey}T00:00:00Z`).getTime();
      const from = new Date(base - 15 * 3600000).toISOString();
      const to = new Date(base + 39 * 3600000).toISOString();
      return (await api.get(`/api/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).data.bookings;
    },
    refetchInterval: 10000,
  });

  const dayBookings = useMemo(() => raw.filter((b) => localDateKey(b.startTime, tz) === dateKey), [raw, tz, dateKey]);
  const docks = [...new Set(dayBookings.map((b) => b.dockId?.dockName).filter(Boolean))].sort() as string[];

  const shown = dayBookings.filter((b) => {
    if (statusFilter === 'ACTIVE' && !['PENDING', 'APPROVED', 'CHECKED_IN', 'IN_PROGRESS'].includes(b.status)) return false;
    if (statusFilter !== 'ALL' && statusFilter !== 'ACTIVE' && b.status !== statusFilter) return false;
    if (dockFilter !== 'ALL' && b.dockId?.dockName !== dockFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return [b.truckNumber, b.vendorId?.vendorCompany, b.driverName, b.referenceNumber].some((v) => v?.toLowerCase().includes(q));
    }
    return true;
  });

  const count = (s: BookingStatus) => dayBookings.filter((b) => b.status === s).length;
  const arrivals = dayBookings.filter((b) => b.arrivalStatus);
  const onTime = arrivals.filter((b) => b.arrivalStatus === 'ON_TIME').length;
  const scheduled = dayBookings.filter((b) => ACTIVE.includes(b.status)).length;

  const statusMutation = useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: BookingStatus; reason?: string }) =>
      api.patch(`/api/bookings/${id}/status`, { status, reason }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['calendar-summary'] });
      const b: Booking = res.data.booking;
      const arrival = b.arrivalStatus === 'LATE' ? ` — arrived ${b.lateByMinutes} min late` : b.arrivalStatus && res.data.booking.status === 'CHECKED_IN' ? ' — on time' : '';
      notify('success', `Truck ${b.truckNumber}: ${STATUS_LABEL[b.status]}${arrival}`);
    },
    onError: (err) => notify('error', errorMessage(err, 'Status update failed')),
  });

  const act = (b: Booking, status: BookingStatus, needsReason = false) => {
    let reason: string | undefined;
    if (needsReason) {
      const r = window.prompt(`Reason for ${STATUS_LABEL[status].toLowerCase()} (optional):`);
      if (r === null) return;
      reason = r || undefined;
    }
    statusMutation.mutate({ id: b._id, status, reason });
  };

  const exportName = `yard-schedule-${dateKey}`;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
      <div className="xl:col-span-1 space-y-6">
        <BookingCalendar selectedDate={selectedDate} onSelectDate={setSelectedDate} />
        <Card title="Day at a glance">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Scheduled" value={scheduled} />
            <Stat label="Pending approval" value={count('PENDING')} tone={count('PENDING') ? 'warn' : 'default'} />
            <Stat label="In yard" value={count('CHECKED_IN')} />
            <Stat label="At dock" value={count('IN_PROGRESS')} />
            <Stat label="Completed" value={count('COMPLETED')} tone="good" />
            <Stat label="No-shows" value={count('NO_SHOW')} tone={count('NO_SHOW') ? 'bad' : 'default'} />
          </div>
          <p className="text-xs text-slate-500 mt-3">
            On-time arrivals today: <b className="text-slate-300">{arrivals.length ? `${Math.round((onTime / arrivals.length) * 100)}%` : '—'}</b> ({arrivals.length} arrived)
          </p>
        </Card>
      </div>

      <div className="xl:col-span-3">
        <Card
          title={
            <span>
              Yard schedule · {fmtDate(`${dateKey}T12:00:00Z`, 'UTC')}
              {isFetching && <span className="ml-2 text-xs text-slate-500 font-normal">refreshing…</span>}
            </span>
          }
          actions={
            <>
              <Button size="sm" onClick={() => refetch()}>Refresh</Button>
              <Button size="sm" onClick={() => exportBookingsCsv(shown, tz, `${exportName}.csv`)}>CSV</Button>
              <Button
                size="sm"
                onClick={() =>
                  exportBookingsPdf(shown, tz, `${warehouse.name} — Yard schedule`, fmtDate(`${dateKey}T12:00:00Z`, 'UTC'), `${exportName}.pdf`)
                }
              >
                PDF
              </Button>
              <Button size="sm" variant="primary" onClick={() => window.open(`/admin/gate-sheet?date=${dateKey}`, '_blank')}>
                Print gate sheet
              </Button>
            </>
          }
        >
          <div className="flex flex-wrap gap-2 mb-4">
            <select className={`${inputClass} !w-auto`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
              <option value="ALL">All statuses</option>
              <option value="ACTIVE">Open (not finished)</option>
              {(Object.keys(STATUS_LABEL) as BookingStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
            <select className={`${inputClass} !w-auto`} value={dockFilter} onChange={(e) => setDockFilter(e.target.value)} aria-label="Filter by dock">
              <option value="ALL">All docks</option>
              {docks.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <input className={`${inputClass} !w-56`} placeholder="Search truck, carrier, PO…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <span className="text-xs text-slate-500 self-center">{shown.length} of {dayBookings.length} appointments</span>
          </div>

          {isLoading ? (
            <Empty>Loading…</Empty>
          ) : shown.length === 0 ? (
            <Empty>No appointments for this day{statusFilter !== 'ALL' || dockFilter !== 'ALL' || search ? ' matching the filters' : ''}.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[980px]">
                <thead className="text-left text-[11px] uppercase text-slate-500 border-b border-slate-800">
                  <tr>
                    <th className="py-2">Slot</th><th>Dock</th><th>Carrier</th><th>Truck / driver</th><th>Load</th><th>Yard times</th><th>Status</th><th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {shown.map((b) => {
                    const started = new Date(b.startTime) <= new Date();
                    const turnaround = minutes(b.checkedInAt, b.completedAt);
                    return (
                      <tr key={b._id} className="align-top hover:bg-slate-800/20">
                        <td className="py-3 font-semibold whitespace-nowrap">
                          {fmtTime(b.startTime, tz)}–{fmtTime(b.endTime, tz)}
                          {b.recurrenceGroupId && <Chip className="block mt-1 w-fit">Weekly</Chip>}
                        </td>
                        <td className="text-xs">{b.dockId?.dockName}</td>
                        <td>
                          {b.vendorId?.vendorCompany}
                          {b.referenceNumber && <span className="block text-[11px] text-slate-500">{b.referenceNumber}</span>}
                        </td>
                        <td>
                          {b.truckNumber}
                          <span className="block text-[11px] text-slate-500">{b.driverName} · {b.driverPhone}</span>
                        </td>
                        <td className="text-xs">
                          <span className={b.direction === 'INBOUND' ? 'text-sky-300' : 'text-violet-300'}>{b.direction === 'INBOUND' ? '⬇ IN' : '⬆ OUT'}</span>{' '}
                          {TRAILER_LABEL[b.trailerType]}
                          {b.hazmat && <Chip className="ml-1 !bg-orange-950 !text-orange-300 !border-orange-700/50">HAZMAT</Chip>}
                          {b.palletCount != null && <span className="block text-slate-500">{b.palletCount} pallets</span>}
                        </td>
                        <td className="text-[11px] text-slate-400 whitespace-nowrap">
                          {b.checkedInAt && <span className="block">Gate in {fmtTime(b.checkedInAt, tz)}</span>}
                          {b.dockStartedAt && <span className="block">At door {fmtTime(b.dockStartedAt, tz)}</span>}
                          {b.completedAt && <span className="block">Out {fmtTime(b.completedAt, tz)}</span>}
                          {turnaround != null && <span className="block text-slate-300">Turnaround {turnaround} min</span>}
                          {!b.checkedInAt && '—'}
                        </td>
                        <td>
                          <BookingStatusBadge status={b.status} />
                          {b.arrivalStatus && (
                            <span className={`block text-[10px] mt-1 ${b.arrivalStatus === 'LATE' ? 'text-amber-400' : 'text-emerald-400'}`}>
                              {b.arrivalStatus === 'LATE' ? `Late ${b.lateByMinutes} min` : 'On time'}
                            </span>
                          )}
                        </td>
                        <td className="text-right whitespace-nowrap space-x-1">
                          {b.status === 'PENDING' && (
                            <>
                              <Button size="sm" variant="success" onClick={() => act(b, 'APPROVED')}>Approve</Button>
                              <Button size="sm" variant="danger" onClick={() => act(b, 'REJECTED', true)}>Reject</Button>
                              <Button size="sm" onClick={() => setRescheduling(b)}>Move</Button>
                            </>
                          )}
                          {b.status === 'APPROVED' && (
                            <>
                              <Button size="sm" variant="primary" onClick={() => act(b, 'CHECKED_IN')}>Gate check-in</Button>
                              <Button size="sm" onClick={() => setRescheduling(b)}>Move</Button>
                              {started && <Button size="sm" variant="danger" onClick={() => act(b, 'NO_SHOW')}>No-show</Button>}
                              <Button size="sm" variant="ghost" onClick={() => act(b, 'CANCELLED', true)}>Cancel</Button>
                            </>
                          )}
                          {b.status === 'CHECKED_IN' && (
                            <>
                              <Button size="sm" variant="primary" onClick={() => act(b, 'IN_PROGRESS')}>Start at dock</Button>
                              <Button size="sm" variant="ghost" onClick={() => act(b, 'CANCELLED', true)}>Cancel</Button>
                            </>
                          )}
                          {b.status === 'IN_PROGRESS' && (
                            <Button size="sm" variant="success" onClick={() => act(b, 'COMPLETED')}>Complete & depart</Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {rescheduling && (
        <RescheduleModal
          booking={{ ...rescheduling, warehouseId: rescheduling.warehouseId ?? { _id: warehouse._id, name: warehouse.name, address: warehouse.address, timezone: tz } }}
          asVendor={false}
          onClose={() => setRescheduling(null)}
          onDone={(text) => {
            setRescheduling(null);
            notify('success', text);
          }}
        />
      )}
    </div>
  );
};
