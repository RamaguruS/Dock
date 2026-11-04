import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api';
import { AppHeader } from '../../components/AppHeader';
import { BookingStatusBadge } from '../../components/BookingStatusBadge';
import { WarehouseAccessPanel } from '../../components/vendor/WarehouseAccessPanel';
import { RescheduleModal } from '../../components/booking/RescheduleModal';
import { Alert, Button, Card, Chip, Empty, Stat, Tabs, TierBadge } from '../../components/ui';
import { type Booking, type CarrierScore, TRAILER_LABEL, errorMessage, fmtDate, fmtTime } from '../../lib/format';
import { exportBookingsCsv } from '../../lib/export';

interface WaitlistEntry {
  _id: string;
  warehouseId: { name: string; timezone: string } | null;
  dockId: { dockName: string } | null;
  startTime: string;
  endTime: string;
  truckNumber: string;
  trailerType: Booking['trailerType'];
  status: 'WAITING' | 'FULFILLED' | 'CANCELLED' | 'EXPIRED';
  createdAt: string;
}

const UPCOMING: Booking['status'][] = ['PENDING', 'APPROVED', 'CHECKED_IN', 'IN_PROGRESS'];

export const VendorDashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('upcoming');
  const [rescheduling, setRescheduling] = useState<Booking | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const { data: bookings = [], isLoading } = useQuery<Booking[]>({
    queryKey: ['vendorBookings'],
    queryFn: async () => (await api.get('/api/bookings')).data.bookings,
    refetchInterval: 20000,
  });
  const { data: score } = useQuery<CarrierScore>({
    queryKey: ['myScore'],
    queryFn: async () => (await api.get('/api/vendors/me/score')).data.score,
  });
  const { data: waitlist = [] } = useQuery<WaitlistEntry[]>({
    queryKey: ['vendorWaitlist'],
    queryFn: async () => (await api.get('/api/waitlist')).data.entries,
    refetchInterval: 20000,
  });

  const onError = (err: unknown) => setMessage({ kind: 'error', text: errorMessage(err) });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['vendorBookings'] });
    queryClient.invalidateQueries({ queryKey: ['vendorWaitlist'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const cancel = useMutation({
    mutationFn: (id: string) => api.patch(`/api/bookings/${id}/status`, { status: 'CANCELLED' }),
    onSuccess: () => {
      refresh();
      setMessage({ kind: 'success', text: 'Appointment cancelled. The slot has been released.' });
    },
    onError,
  });
  const cancelSeries = useMutation({
    mutationFn: (groupId: string) => api.patch(`/api/bookings/series/${groupId}/cancel`),
    onSuccess: (res) => {
      refresh();
      setMessage({ kind: 'success', text: res.data.message });
    },
    onError,
  });
  const leaveWaitlist = useMutation({
    mutationFn: (id: string) => api.delete(`/api/waitlist/${id}`),
    onSuccess: () => {
      refresh();
      setMessage({ kind: 'success', text: 'Removed from waitlist' });
    },
    onError,
  });

  const upcoming = bookings.filter((b) => UPCOMING.includes(b.status));
  const history = bookings.filter((b) => !UPCOMING.includes(b.status)).reverse();
  const waiting = waitlist.filter((w) => w.status === 'WAITING');
  const list = tab === 'upcoming' ? upcoming : history;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-6 lg:p-8">
      <AppHeader
        eyebrow="Carrier portal"
        title={user?.vendorCompany || 'Carrier dashboard'}
        subtitle={<>Book and manage dock appointments · {user?.email}</>}
        actions={
          <Button variant="primary" onClick={() => navigate('/vendor/book')}>
            + Book dock appointment
          </Button>
        }
      />

      <main className="max-w-7xl mx-auto space-y-6">
        {message && (
          <Alert kind={message.kind} onClose={() => setMessage(null)}>
            {message.text}
          </Alert>
        )}

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
            <p className="text-[11px] uppercase tracking-wider font-bold text-slate-500">Your reliability score</p>
            <div className="flex items-end gap-3 mt-1">
              <span className="text-4xl font-extrabold">{score?.reliabilityScore ?? '—'}</span>
              <TierBadge score={score} />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              (on-time + ½ × late) ÷ (arrivals + no-shows). Warehouses see this when approving your requests.
            </p>
          </div>
          <Stat label="On-time arrivals" value={score?.onTimeRate != null ? `${score.onTimeRate}%` : '—'} tone="good" />
          <Stat label="No-shows" value={score?.noShows ?? 0} hint={score?.noShowRate != null ? `${score.noShowRate}% of due` : undefined} tone={score && score.noShows > 0 ? 'bad' : 'default'} />
          <Stat label="Upcoming" value={upcoming.length} hint={`${waiting.length} on waitlist`} />
        </div>

        <WarehouseAccessPanel />

        <Card
          title="My appointments"
          actions={
            <Button size="sm" onClick={() => exportBookingsCsv(bookings, Intl.DateTimeFormat().resolvedOptions().timeZone, 'my-appointments.csv')}>
              Export CSV
            </Button>
          }
        >
          <Tabs
            tabs={[
              { id: 'upcoming', label: 'Upcoming', badge: upcoming.length },
              { id: 'history', label: 'History' },
              { id: 'waitlist', label: 'Waitlist', badge: waiting.length },
            ]}
            active={tab}
            onChange={setTab}
          />

          {tab === 'waitlist' ? (
            waitlist.length === 0 ? (
              <Empty>No waitlist entries. When a slot is full, you can join its waitlist from the booking screen.</Empty>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase text-slate-500">
                  <tr><th className="py-2">Slot</th><th>Site / dock</th><th>Truck</th><th>Status</th><th /></tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {waitlist.map((w) => (
                    <tr key={w._id}>
                      <td className="py-2.5">{fmtDate(w.startTime, w.warehouseId?.timezone)} · {fmtTime(w.startTime, w.warehouseId?.timezone)}</td>
                      <td>{w.warehouseId?.name}<span className="block text-xs text-slate-500">{w.dockId?.dockName ?? 'Any compatible dock'}</span></td>
                      <td>{w.truckNumber}<span className="block text-xs text-slate-500">{TRAILER_LABEL[w.trailerType]}</span></td>
                      <td><Chip>{w.status === 'FULFILLED' ? 'Assigned ✓' : w.status.toLowerCase()}</Chip></td>
                      <td className="text-right">
                        {w.status === 'WAITING' && <Button size="sm" variant="danger" onClick={() => leaveWaitlist.mutate(w._id)}>Leave</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : isLoading ? (
            <Empty>Loading…</Empty>
          ) : list.length === 0 ? (
            <Empty>{tab === 'upcoming' ? 'No upcoming appointments. Click “Book dock appointment” to schedule one.' : 'No past appointments yet.'}</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[860px]">
                <thead className="text-left text-[11px] uppercase text-slate-500">
                  <tr>
                    <th className="py-2">When (site time)</th><th>Site / dock</th><th>Truck / driver</th><th>Load</th><th>Ref</th><th>Status</th><th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {list.slice(0, 200).map((b) => {
                    const tz = b.warehouseId?.timezone;
                    const mutable = b.status === 'PENDING' || b.status === 'APPROVED';
                    return (
                      <tr key={b._id} className="align-top">
                        <td className="py-3">
                          <span className="font-semibold">{fmtDate(b.startTime, tz)}</span>
                          <span className="block text-xs text-slate-400">{fmtTime(b.startTime, tz)}–{fmtTime(b.endTime, tz)}</span>
                          {b.recurrenceGroupId && <Chip className="mt-1">Weekly series</Chip>}
                        </td>
                        <td>{b.warehouseId?.name}<span className="block text-xs text-slate-500">{b.dockId?.dockName}</span></td>
                        <td>{b.truckNumber}<span className="block text-xs text-slate-500">{b.driverName} · {b.driverPhone}</span></td>
                        <td className="text-xs">
                          {b.direction === 'INBOUND' ? 'Inbound' : 'Outbound'}
                          <span className="block text-slate-500">{TRAILER_LABEL[b.trailerType]}{b.hazmat ? ' · Hazmat' : ''}{b.palletCount ? ` · ${b.palletCount} pallets` : ''}</span>
                        </td>
                        <td className="text-xs text-slate-400">{b.referenceNumber ?? '—'}</td>
                        <td>
                          <BookingStatusBadge status={b.status} />
                          {b.arrivalStatus && (
                            <span className={`block text-[10px] mt-1 ${b.arrivalStatus === 'LATE' ? 'text-amber-400' : 'text-emerald-400'}`}>
                              {b.arrivalStatus === 'LATE' ? `Arrived ${b.lateByMinutes} min late` : 'Arrived on time'}
                            </span>
                          )}
                          {b.cancelReason && <span className="block text-[10px] text-slate-500 mt-1 max-w-40">{b.cancelReason}</span>}
                        </td>
                        <td className="text-right space-x-1 whitespace-nowrap">
                          {mutable && (
                            <>
                              <Button size="sm" onClick={() => setRescheduling(b)}>Reschedule</Button>
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => window.confirm(`Cancel truck ${b.truckNumber} on ${fmtDate(b.startTime, tz)}?`) && cancel.mutate(b._id)}
                              >
                                Cancel
                              </Button>
                              {b.recurrenceGroupId && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => window.confirm('Cancel all upcoming appointments in this weekly series?') && cancelSeries.mutate(b.recurrenceGroupId!)}
                                >
                                  Cancel series
                                </Button>
                              )}
                            </>
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
      </main>

      {rescheduling && (
        <RescheduleModal
          booking={rescheduling}
          asVendor
          onClose={() => setRescheduling(null)}
          onDone={(text) => {
            setRescheduling(null);
            setMessage({ kind: 'success', text });
          }}
        />
      )}
    </div>
  );
};
