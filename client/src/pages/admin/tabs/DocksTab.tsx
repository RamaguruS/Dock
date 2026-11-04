import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api';
import { Button, Card, Chip, Empty, Field, Modal, inputClass } from '../../../components/ui';
import { DIRECTION_LABEL, type DockDirection, TRAILER_LABEL, TRAILER_TYPES, type TrailerType, errorMessage, fmtDateTime } from '../../../lib/format';
import { type Dock, type Notify, type Warehouse } from '../types';

interface DockForm {
  id?: string;
  dockName: string;
  maxCapacityPerHour: number;
  direction: DockDirection;
  supportedTrailerTypes: TrailerType[];
  hazmatCertified: boolean;
  isActive: boolean;
}

const EMPTY_FORM: DockForm = {
  dockName: '',
  maxCapacityPerHour: 1,
  direction: 'BOTH',
  supportedTrailerTypes: ['DRY_VAN', 'CONTAINER'],
  hazmatCertified: false,
  isActive: true,
};

export const DocksTab: React.FC<{ warehouse: Warehouse; notify: Notify }> = ({ warehouse, notify }) => {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<DockForm | null>(null);
  const [maintenanceFor, setMaintenanceFor] = useState<Dock | null>(null);
  const [maint, setMaint] = useState({ start: '', end: '', reason: '' });

  const { data: docks = [], isLoading } = useQuery<Dock[]>({
    queryKey: ['docks'],
    queryFn: async () => (await api.get('/api/docks')).data.docks,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['docks'] });
    queryClient.invalidateQueries({ queryKey: ['availability'] });
  };

  const save = useMutation({
    mutationFn: (f: DockForm) => {
      const { id, ...body } = f;
      return id ? api.put(`/api/docks/${id}`, body) : api.post('/api/docks', body);
    },
    onSuccess: (res) => {
      invalidate();
      setForm(null);
      notify('success', res.data.message);
    },
    onError: (err) => notify('error', errorMessage(err, 'Failed to save dock')),
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => api.patch(`/api/docks/${id}/deactivate`),
    onSuccess: (res) => {
      invalidate();
      notify('success', res.data.message);
    },
    onError: (err) => notify('error', errorMessage(err)),
  });

  const addMaintenance = useMutation({
    mutationFn: () =>
      api.post(`/api/docks/${maintenanceFor!._id}/maintenance`, {
        startTime: new Date(maint.start).toISOString(),
        endTime: new Date(maint.end).toISOString(),
        reason: maint.reason,
      }),
    onSuccess: (res) => {
      invalidate();
      setMaintenanceFor(null);
      setMaint({ start: '', end: '', reason: '' });
      const affected = res.data.affectedBookings as { truckNumber: string; vendorId?: { vendorCompany: string } }[];
      notify(
        affected.length ? 'error' : 'success',
        affected.length
          ? `${res.data.message} Affected: ${affected.map((b) => `${b.truckNumber} (${b.vendorId?.vendorCompany})`).join(', ')}. Use "Move" on the Yard schedule.`
          : res.data.message
      );
    },
    onError: (err) => notify('error', errorMessage(err)),
  });

  const removeMaintenance = useMutation({
    mutationFn: ({ dockId, windowId }: { dockId: string; windowId: string }) => api.delete(`/api/docks/${dockId}/maintenance/${windowId}`),
    onSuccess: () => {
      invalidate();
      notify('success', 'Maintenance window removed');
    },
    onError: (err) => notify('error', errorMessage(err)),
  });

  const toggleTrailer = (t: TrailerType) =>
    setForm((f) =>
      f && {
        ...f,
        supportedTrailerTypes: f.supportedTrailerTypes.includes(t)
          ? f.supportedTrailerTypes.filter((x) => x !== t)
          : [...f.supportedTrailerTypes, t],
      }
    );

  return (
    <>
      <Card
        title={`Dock doors at ${warehouse.name}`}
        actions={<Button variant="primary" onClick={() => setForm({ ...EMPTY_FORM })}>+ Add dock</Button>}
      >
        <p className="text-xs text-slate-500 mb-4">
          Each dock door declares what it can handle. Carriers only see docks compatible with their load (movement direction, trailer type,
          hazmat), and maintenance windows block the affected slots.
        </p>
        {isLoading ? (
          <Empty>Loading docks…</Empty>
        ) : docks.length === 0 ? (
          <Empty>No docks yet. Add your first dock door.</Empty>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {docks.map((dock) => {
              const upcomingMaint = dock.maintenanceWindows.filter((w) => new Date(w.endTime) > new Date());
              return (
                <div key={dock._id} className={`rounded-xl border p-4 ${dock.isActive ? 'border-slate-700 bg-slate-950/50' : 'border-slate-800 bg-slate-950/20 opacity-60'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold">{dock.dockName}</p>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        <Chip>{DIRECTION_LABEL[dock.direction]}</Chip>
                        {dock.supportedTrailerTypes.map((t) => <Chip key={t}>{TRAILER_LABEL[t]}</Chip>)}
                        {dock.hazmatCertified && <Chip className="!bg-orange-950 !text-orange-300 !border-orange-700/50">Hazmat certified</Chip>}
                        <Chip>{dock.maxCapacityPerHour} truck{dock.maxCapacityPerHour > 1 ? 's' : ''} / slot</Chip>
                      </div>
                    </div>
                    <Chip className={dock.isActive ? '!bg-green-950 !text-green-400 !border-green-600/30' : '!bg-red-950 !text-red-400'}>
                      {dock.isActive ? 'Active' : 'Inactive'}
                    </Chip>
                  </div>

                  <div className="mt-3">
                    <p className="text-[11px] uppercase font-bold text-slate-500">Planned maintenance</p>
                    {upcomingMaint.length === 0 ? (
                      <p className="text-xs text-slate-500 mt-1">None scheduled</p>
                    ) : (
                      <ul className="mt-1 space-y-1">
                        {upcomingMaint.map((w) => (
                          <li key={w._id} className="flex items-center justify-between gap-2 text-xs bg-orange-950/30 border border-orange-900/40 rounded-lg px-2 py-1.5">
                            <span>
                              🛠 {fmtDateTime(w.startTime, warehouse.timezone)} → {fmtDateTime(w.endTime, warehouse.timezone)} · {w.reason}
                            </span>
                            <button
                              className="text-red-400 hover:text-red-300 cursor-pointer"
                              onClick={() => removeMaintenance.mutate({ dockId: dock._id, windowId: w._id })}
                              aria-label="Remove maintenance window"
                            >
                              ✕
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 mt-4">
                    <Button size="sm" onClick={() => setForm({ id: dock._id, ...dock })}>Edit</Button>
                    <Button size="sm" onClick={() => setMaintenanceFor(dock)} disabled={!dock.isActive}>Schedule maintenance</Button>
                    {dock.isActive ? (
                      <Button size="sm" variant="danger" onClick={() => window.confirm(`Deactivate ${dock.dockName}?`) && deactivate.mutate(dock._id)}>
                        Deactivate
                      </Button>
                    ) : (
                      <Button size="sm" variant="success" onClick={() => save.mutate({ id: dock._id, ...dock, isActive: true })}>
                        Reactivate
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {form && (
        <Modal title={form.id ? `Edit ${form.dockName}` : 'Add dock door'} onClose={() => setForm(null)}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(form);
            }}
          >
            <Field label="Dock name">
              <input className={inputClass} required value={form.dockName} onChange={(e) => setForm({ ...form, dockName: e.target.value })} placeholder="D-06 Cross-dock" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Movement direction">
                <select className={inputClass} value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as DockDirection })}>
                  {(['INBOUND', 'OUTBOUND', 'BOTH'] as DockDirection[]).map((d) => <option key={d} value={d}>{DIRECTION_LABEL[d]}</option>)}
                </select>
              </Field>
              <Field label="Trucks per slot (capacity)">
                <input type="number" min={1} max={20} className={inputClass} value={form.maxCapacityPerHour} onChange={(e) => setForm({ ...form, maxCapacityPerHour: Number(e.target.value) || 1 })} />
              </Field>
            </div>
            <Field label="Supported trailer / equipment types">
              <div className="grid grid-cols-2 gap-2">
                {TRAILER_TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" className="accent-purple-500" checked={form.supportedTrailerTypes.includes(t)} onChange={() => toggleTrailer(t)} />
                    {TRAILER_LABEL[t]}
                  </label>
                ))}
              </div>
            </Field>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="accent-orange-500" checked={form.hazmatCertified} onChange={(e) => setForm({ ...form, hazmatCertified: e.target.checked })} />
              Hazmat certified (spill containment, safety equipment)
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" onClick={() => setForm(null)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={save.isPending || form.supportedTrailerTypes.length === 0}>
                {save.isPending ? 'Saving…' : 'Save dock'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {maintenanceFor && (
        <Modal title={`Schedule maintenance · ${maintenanceFor.dockName}`} onClose={() => setMaintenanceFor(null)}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              addMaintenance.mutate();
            }}
          >
            <p className="text-xs text-slate-500">Times are in your browser's local time. Slots overlapping this window can't be booked.</p>
            <div className="grid grid-cols-2 gap-4">
              <Field label="From">
                <input type="datetime-local" required className={inputClass} value={maint.start} onChange={(e) => setMaint({ ...maint, start: e.target.value })} />
              </Field>
              <Field label="To">
                <input type="datetime-local" required className={inputClass} value={maint.end} onChange={(e) => setMaint({ ...maint, end: e.target.value })} />
              </Field>
            </div>
            <Field label="Reason">
              <input className={inputClass} required placeholder="Dock leveller repair" value={maint.reason} onChange={(e) => setMaint({ ...maint, reason: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setMaintenanceFor(null)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={addMaintenance.isPending}>Schedule</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
};
