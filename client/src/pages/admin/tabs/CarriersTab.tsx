import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api';
import { Button, Card, Chip, Empty, TierBadge } from '../../../components/ui';
import { type CarrierScore, TRAILER_LABEL, type TrailerType, errorMessage, fmtDateTime } from '../../../lib/format';
import { downloadCsv } from '../../../lib/export';
import { type Notify, type Warehouse } from '../types';

interface PendingVendor {
  _id: string;
  username: string;
  email: string;
  vendorCompany: string;
  requestedAt: string;
  score?: CarrierScore;
}

interface Scorecard {
  vendorId: string;
  username: string;
  email: string;
  vendorCompany: string;
  accessStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  atWarehouse?: CarrierScore;
  overall?: CarrierScore;
}

interface WaitlistEntry {
  _id: string;
  vendorId: { vendorCompany: string; username: string } | null;
  dockId: { dockName: string } | null;
  startTime: string;
  truckNumber: string;
  trailerType: TrailerType;
  direction: 'INBOUND' | 'OUTBOUND';
  createdAt: string;
}

const pct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`);

export const CarriersTab: React.FC<{ warehouse: Warehouse; notify: Notify }> = ({ warehouse, notify }) => {
  const queryClient = useQueryClient();
  const tz = warehouse.timezone;

  const { data: pending = [] } = useQuery<PendingVendor[]>({
    queryKey: ['pendingVendors'],
    queryFn: async () => (await api.get('/api/vendors/pending')).data.vendors,
  });
  const { data: carriers = [], isLoading } = useQuery<Scorecard[]>({
    queryKey: ['scorecards'],
    queryFn: async () => (await api.get('/api/vendors/scorecards')).data.carriers,
  });
  const { data: waitlist = [] } = useQuery<WaitlistEntry[]>({
    queryKey: ['adminWaitlist'],
    queryFn: async () => (await api.get('/api/waitlist')).data.entries,
    refetchInterval: 15000,
  });

  const decide = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'APPROVED' | 'REJECTED' }) => api.patch(`/api/vendors/${id}/status`, { status }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['pendingVendors'] });
      queryClient.invalidateQueries({ queryKey: ['scorecards'] });
      notify('success', res.data.message);
    },
    onError: (err) => notify('error', errorMessage(err)),
  });
  const removeWaitlist = useMutation({
    mutationFn: (id: string) => api.delete(`/api/waitlist/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminWaitlist'] });
      notify('success', 'Waitlist entry removed');
    },
    onError: (err) => notify('error', errorMessage(err)),
  });

  const exportScorecards = () =>
    downloadCsv(
      'carrier-scorecards.csv',
      ['Carrier', 'Email', 'Access', 'Appointments here', 'On-time %', 'Late', 'No-shows', 'Late cancellations', 'Avg late (min)', 'Reliability score', 'Tier'],
      carriers.map((c) => [
        c.vendorCompany, c.email, c.accessStatus, c.atWarehouse?.totalAppointments, c.atWarehouse?.onTimeRate, c.atWarehouse?.late,
        c.atWarehouse?.noShows, c.atWarehouse?.lateCancellations, c.atWarehouse?.avgLateMinutes, c.overall?.reliabilityScore, c.overall?.tierLabel,
      ])
    );

  return (
    <div className="space-y-6">
      <Card title={`Access requests (${pending.length})`}>
        {pending.length === 0 ? (
          <Empty>No carriers are waiting for approval.</Empty>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {pending.map((v) => (
              <div key={v._id} className="rounded-xl border border-slate-700 bg-slate-950/50 p-4 flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold">{v.vendorCompany}</p>
                  <p className="text-xs text-slate-400">{v.username} · {v.email}</p>
                  <p className="text-[11px] text-slate-500 mt-1">Requested {fmtDateTime(v.requestedAt, tz)}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[11px] text-slate-500">Track record:</span>
                    <TierBadge score={v.score} />
                    {v.score && v.score.totalAppointments > 0 && (
                      <span className="text-[11px] text-slate-500">{v.score.totalAppointments} appts across SmartDock</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Button size="sm" variant="success" onClick={() => decide.mutate({ id: v._id, status: 'APPROVED' })}>Approve</Button>
                  <Button size="sm" variant="danger" onClick={() => decide.mutate({ id: v._id, status: 'REJECTED' })}>Reject</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Carrier scorecard" actions={<Button size="sm" onClick={exportScorecards}>Export CSV</Button>}>
        <p className="text-xs text-slate-500 mb-3">
          Reliability = (on-time arrivals + ½ × late arrivals) ÷ (arrivals + no-shows) × 100 across all SmartDock sites.
          Tier A ≥ 90 · B ≥ 75 · C ≥ 50 · D below 50. Arrivals more than {warehouse.lateThresholdMinutes} min after slot start count as late.
        </p>
        {isLoading ? (
          <Empty>Loading…</Empty>
        ) : carriers.length === 0 ? (
          <Empty>No carriers yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="text-left text-[11px] uppercase text-slate-500 border-b border-slate-800">
                <tr>
                  <th className="py-2">Carrier</th><th>Access</th><th>Appts here</th><th>On-time</th><th>Late</th><th>No-shows</th><th>Late cancels</th><th>Avg delay</th><th>Reliability</th><th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {carriers.map((c) => (
                  <tr key={c.vendorId}>
                    <td className="py-2.5">{c.vendorCompany}<span className="block text-[11px] text-slate-500">{c.email}</span></td>
                    <td><Chip>{c.accessStatus.toLowerCase()}</Chip></td>
                    <td>{c.atWarehouse?.totalAppointments ?? 0}</td>
                    <td className="text-emerald-400">{pct(c.atWarehouse?.onTimeRate)}</td>
                    <td className="text-amber-400">{c.atWarehouse?.late ?? 0}</td>
                    <td className="text-red-400">{c.atWarehouse?.noShows ?? 0}</td>
                    <td>{c.atWarehouse?.lateCancellations ?? 0}</td>
                    <td>{c.atWarehouse?.avgLateMinutes != null ? `${c.atWarehouse.avgLateMinutes} min` : '—'}</td>
                    <td><TierBadge score={c.overall} /></td>
                    <td className="text-right whitespace-nowrap">
                      {c.accessStatus === 'APPROVED' ? (
                        <Button size="sm" variant="ghost" onClick={() => window.confirm(`Revoke ${c.vendorCompany}'s booking access?`) && decide.mutate({ id: c.vendorId, status: 'REJECTED' })}>
                          Revoke
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: c.vendorId, status: 'APPROVED' })}>Approve</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`Waitlist (${waitlist.length} waiting)`}>
        <p className="text-xs text-slate-500 mb-3">
          When an appointment is cancelled, rejected or moved, the freed place is automatically given to the first compatible carrier waiting for
          that slot (first come, first served). The new booking still needs your approval.
        </p>
        {waitlist.length === 0 ? (
          <Empty>Nobody is waiting for a slot.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase text-slate-500 border-b border-slate-800">
              <tr><th className="py-2">Slot</th><th>Dock</th><th>Carrier</th><th>Truck / load</th><th>Joined</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {waitlist.map((w) => (
                <tr key={w._id}>
                  <td className="py-2.5">{fmtDateTime(w.startTime, tz)}</td>
                  <td>{w.dockId?.dockName ?? 'Any compatible'}</td>
                  <td>{w.vendorId?.vendorCompany}</td>
                  <td>{w.truckNumber}<span className="block text-[11px] text-slate-500">{w.direction.toLowerCase()} · {TRAILER_LABEL[w.trailerType]}</span></td>
                  <td className="text-xs text-slate-400">{fmtDateTime(w.createdAt, tz)}</td>
                  <td className="text-right"><Button size="sm" variant="ghost" onClick={() => removeWaitlist.mutate(w._id)}>Remove</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
};
