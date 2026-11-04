import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api';
import { useAuth } from '../../../context/AuthContext';
import { Button, Card, Field, inputClass } from '../../../components/ui';
import { errorMessage } from '../../../lib/format';
import { type Notify, type OperatingHour, type Warehouse } from '../types';

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export const SettingsTab: React.FC<{ warehouse: Warehouse; notify: Notify }> = ({ warehouse, notify }) => {
  const queryClient = useQueryClient();
  const { logout } = useAuth();
  const [rules, setRules] = useState({
    slotDurationMinutes: warehouse.slotDurationMinutes,
    bufferMinutes: warehouse.bufferMinutes,
    lateThresholdMinutes: warehouse.lateThresholdMinutes,
    noShowGraceMinutes: warehouse.noShowGraceMinutes,
  });
  const [hours, setHours] = useState<OperatingHour[]>(warehouse.operatingHours);
  const [blackout, setBlackout] = useState({ date: '', reason: '' });

  useEffect(() => setHours(warehouse.operatingHours), [warehouse.operatingHours]);

  const { data: demo } = useQuery<{ demoMode: boolean }>({
    queryKey: ['demoInfo'],
    queryFn: async () => (await api.get('/api/demo/info')).data,
  });

  const refresh = (msg: string) => {
    queryClient.invalidateQueries({ queryKey: ['warehouse'] });
    queryClient.invalidateQueries({ queryKey: ['availability'] });
    queryClient.invalidateQueries({ queryKey: ['availability-summary'] });
    notify('success', msg);
  };
  const onError = (err: unknown) => notify('error', errorMessage(err));

  const saveRules = useMutation({ mutationFn: () => api.put('/api/warehouses/settings', rules), onSuccess: (r) => refresh(r.data.message), onError });
  const saveHours = useMutation({ mutationFn: () => api.put('/api/warehouses/operating-hours', { operatingHours: hours }), onSuccess: (r) => refresh(r.data.message), onError });
  const addBlackout = useMutation({
    mutationFn: () => api.post('/api/warehouses/blackouts', blackout),
    onSuccess: (r) => {
      setBlackout({ date: '', reason: '' });
      refresh(r.data.message);
    },
    onError,
  });
  const removeBlackout = useMutation({ mutationFn: (date: string) => api.delete(`/api/warehouses/blackouts/${date}`), onSuccess: (r) => refresh(r.data.message), onError });
  const resetDemo = useMutation({
    mutationFn: () => api.post('/api/demo/reset'),
    onSuccess: () => {
      queryClient.clear();
      logout();
      window.location.href = '/login?reset=1';
    },
    onError,
  });

  // Preview of the slot grid for the first open day with the rules being edited
  const preview = useMemo(() => {
    const day = hours.find((h) => h.isOpen);
    if (!day) return [];
    const slots: string[] = [];
    for (let t = toMin(day.start); t + rules.slotDurationMinutes <= toMin(day.end); t += rules.slotDurationMinutes + rules.bufferMinutes) {
      slots.push(`${toHHMM(t)}–${toHHMM(t + rules.slotDurationMinutes)}`);
    }
    return slots;
  }, [hours, rules.slotDurationMinutes, rules.bufferMinutes]);

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Card title="Appointment rules">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Slot length" hint="Length of one dock appointment">
            <select className={inputClass} value={rules.slotDurationMinutes} onChange={(e) => setRules({ ...rules, slotDurationMinutes: Number(e.target.value) })}>
              {[15, 30, 60, 90].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
          </Field>
          <Field label="Buffer between trucks" hint="Turnover time: trailer swap, dock clean-down">
            <select className={inputClass} value={rules.bufferMinutes} onChange={(e) => setRules({ ...rules, bufferMinutes: Number(e.target.value) })}>
              {[0, 5, 10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m === 0 ? 'None' : `${m} minutes`}</option>)}
            </select>
          </Field>
          <Field label="Late after (minutes)" hint="Check-in later than this = late arrival">
            <input type="number" min={0} max={240} className={inputClass} value={rules.lateThresholdMinutes} onChange={(e) => setRules({ ...rules, lateThresholdMinutes: Number(e.target.value) })} />
          </Field>
          <Field label="No-show after (minutes)" hint="Confirmed trucks not arrived by then are marked no-show automatically">
            <input type="number" min={5} max={480} className={inputClass} value={rules.noShowGraceMinutes} onChange={(e) => setRules({ ...rules, noShowGraceMinutes: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="mt-4 bg-slate-950/60 border border-slate-800 rounded-xl p-3">
          <p className="text-[11px] uppercase font-bold text-slate-500 mb-2">Preview · {preview.length} slots per dock per day</p>
          <div className="flex flex-wrap gap-1">
            {preview.slice(0, 40).map((s) => <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">{s}</span>)}
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <Button variant="primary" onClick={() => saveRules.mutate()} disabled={saveRules.isPending}>Save rules</Button>
        </div>
      </Card>

      <Card title="Operating hours (site time)">
        <div className="space-y-2">
          {hours.map((h, i) => (
            <div key={h.day} className="grid grid-cols-[6rem_auto_1fr_1fr] items-center gap-2 text-sm">
              <span className="capitalize text-slate-300">{h.day}</span>
              <input type="checkbox" className="accent-purple-500" checked={h.isOpen} aria-label={`${h.day} open`} onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, isOpen: e.target.checked } : x)))} />
              <input type="time" className={inputClass} disabled={!h.isOpen} value={h.start} aria-label={`${h.day} opens`} onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
              <input type="time" className={inputClass} disabled={!h.isOpen} value={h.end} aria-label={`${h.day} closes`} onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
            </div>
          ))}
        </div>
        <div className="flex justify-end mt-4">
          <Button variant="primary" onClick={() => saveHours.mutate()} disabled={saveHours.isPending}>Save hours</Button>
        </div>
      </Card>

      <Card title="Holidays & blackout dates">
        <p className="text-xs text-slate-500 mb-3">No appointments can be booked on these dates (public holidays, stock-takes, site shutdowns).</p>
        <form
          className="flex flex-wrap gap-2 mb-4"
          onSubmit={(e) => {
            e.preventDefault();
            addBlackout.mutate();
          }}
        >
          <input type="date" required className={`${inputClass} !w-auto`} value={blackout.date} onChange={(e) => setBlackout({ ...blackout, date: e.target.value })} aria-label="Blackout date" />
          <input required className={`${inputClass} !w-56`} placeholder="Reason, e.g. Diwali" value={blackout.reason} onChange={(e) => setBlackout({ ...blackout, reason: e.target.value })} />
          <Button type="submit" variant="primary">Add</Button>
        </form>
        {warehouse.blackoutDates.length === 0 ? (
          <p className="text-sm text-slate-500">No blackout dates.</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {warehouse.blackoutDates.map((b) => (
              <li key={b.date} className="flex items-center justify-between py-2 text-sm">
                <span>
                  <b>{b.date}</b> · {b.reason}
                </span>
                <Button size="sm" variant="ghost" onClick={() => removeBlackout.mutate(b.date)}>Remove</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {demo?.demoMode && (
        <Card title="Demo data">
          <p className="text-sm text-slate-400">
            Regenerates the whole demo (5 weeks of history, today's live yard, upcoming bookings, a weekly series and a waitlist) relative to the
            current time. Do this right before presenting. <b className="text-slate-200">All data, including accounts registered during the demo, is replaced.</b>
          </p>
          <div className="flex justify-end mt-4">
            <Button
              variant="danger"
              disabled={resetDemo.isPending}
              onClick={() => window.confirm('Reset ALL demo data now? You will be logged out.') && resetDemo.mutate()}
            >
              {resetDemo.isPending ? 'Resetting…' : 'Reset demo data'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
};
