import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api';
import { Button, Card, Empty, Field, Stat, TierBadge, inputClass } from '../../../components/ui';
import { type CarrierScore, TRAILER_LABEL, type TrailerType, addDaysKey, todayKey } from '../../../lib/format';
import { downloadCsv, downloadPdfTable } from '../../../lib/export';
import { type Warehouse } from '../types';

interface Analytics {
  range: { from: string; to: string; days: number; timezone: string };
  kpis: {
    totalAppointments: number;
    completed: number;
    dockUtilization: number | null;
    offeredCapacity: number;
    onTimeRate: number | null;
    noShowRate: number | null;
    cancellationRate: number | null;
    avgTurnaroundMinutes: number | null;
    avgYardWaitMinutes: number | null;
    avgDockMinutes: number | null;
    palletsHandled: number;
    avgDailyAppointments: number;
  };
  byStatus: Record<string, number>;
  byDirection: Record<string, number>;
  byTrailerType: Record<string, number>;
  heatmap: number[][];
  busiestHours: { hour: number; label: string; count: number }[];
  daily: { date: string; total: number; completed: number; noShow: number; cancelled: number }[];
  perDock: { dockId: string; dockName: string; direction: string; isActive: boolean; appointments: number; capacity: number; utilization: number | null; avgDockMinutes: number | null }[];
  carriers: {
    vendorId: string;
    name: string;
    appointments: number;
    completed: number;
    onTime: number;
    late: number;
    noShows: number;
    cancelled: number;
    onTimeRate: number | null;
    avgLateMinutes: number | null;
    pallets: number;
    reliabilityScore: number | null;
    tier: CarrierScore['tier'];
    tierLabel: string;
  }[];
}

// Dark-surface chart tokens (reference palette, dark column)
const SERIES = '#3987e5';
// Sequential blue ramp: on the dark surface "near zero" recedes toward the surface (dark), high values are light
const SEQ = ['#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#86b6ef', '#b7d3f6', '#cde2fb'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`);
const fmtMin = (v: number | null | undefined) => (v == null ? '—' : `${v} min`);

/** Hover tooltip shared by every chart in this tab. */
const useTooltip = () => {
  const [tip, setTip] = useState<{ x: number; y: number; content: React.ReactNode } | null>(null);
  const bind = (content: React.ReactNode) => ({
    onMouseMove: (e: React.MouseEvent) => {
      const host = (e.currentTarget as HTMLElement).closest('[data-chart]') as HTMLElement;
      const rect = host.getBoundingClientRect();
      setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, content });
    },
    onMouseLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent) => {
      const host = (e.currentTarget as HTMLElement).closest('[data-chart]') as HTMLElement;
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const h = host.getBoundingClientRect();
      setTip({ x: r.left - h.left + r.width / 2, y: r.top - h.top, content });
    },
    onBlur: () => setTip(null),
    tabIndex: 0,
  });
  const node = tip && (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full -mt-2 px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-xs text-slate-100 shadow-xl whitespace-nowrap"
      style={{ left: tip.x, top: tip.y - 8 }}
    >
      {tip.content}
    </div>
  );
  return { bind, node };
};

/** Horizontal bar list: one series, value label in text ink, 4px rounded data end. */
const BarList: React.FC<{ rows: { label: string; value: number; display: string; detail?: string }[]; max?: number }> = ({ rows, max }) => {
  const { bind, node } = useTooltip();
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="relative space-y-2" data-chart>
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(0,10rem)_1fr_3.5rem] items-center gap-3 text-xs outline-none" {...bind(<><b>{r.label}</b>: {r.display}{r.detail ? ` · ${r.detail}` : ''}</>)}>
          <span className="truncate text-slate-300">{r.label}</span>
          <div className="h-3 bg-slate-800/60 rounded">
            <div className="h-3 rounded-r" style={{ width: `${Math.min(100, (r.value / top) * 100)}%`, background: SERIES, borderRadius: '0 4px 4px 0' }} />
          </div>
          <span className="text-right text-slate-300 font-semibold tabular-nums">{r.display}</span>
        </div>
      ))}
      {node}
    </div>
  );
};

export const AnalyticsTab: React.FC<{ warehouse: Warehouse }> = ({ warehouse }) => {
  const tz = warehouse.timezone;
  const today = todayKey(tz);
  const [range, setRange] = useState({ from: addDaysKey(today, -29), to: today });
  const daily = useTooltip();
  const heat = useTooltip();

  const { data, isLoading, isError } = useQuery<Analytics>({
    queryKey: ['analytics', range.from, range.to],
    queryFn: async () => (await api.get(`/api/analytics?from=${range.from}&to=${range.to}`)).data,
  });

  const preset = (days: number) => setRange({ from: addDaysKey(today, -(days - 1)), to: today });

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      `kpi-report-${range.from}-to-${range.to}.csv`,
      ['Carrier', 'Appointments', 'Completed', 'On time', 'Late', 'No-shows', 'Cancelled', 'On-time %', 'Avg delay (min)', 'Pallets', 'Reliability', 'Tier'],
      data.carriers.map((c) => [c.name, c.appointments, c.completed, c.onTime, c.late, c.noShows, c.cancelled, c.onTimeRate, c.avgLateMinutes, c.pallets, c.reliabilityScore, c.tierLabel])
    );
  };

  const exportPdf = () => {
    if (!data) return;
    const k = data.kpis;
    downloadPdfTable({
      filename: `kpi-report-${range.from}-to-${range.to}.pdf`,
      title: `${warehouse.name} — Dock operations KPI report`,
      subtitle: `${range.from} to ${range.to} (${data.range.days} days, site time ${tz})`,
      summary: [
        ['Appointments', String(k.totalAppointments)],
        ['Dock utilization', fmtPct(k.dockUtilization)],
        ['On-time arrival rate', fmtPct(k.onTimeRate)],
        ['No-show rate', fmtPct(k.noShowRate)],
        ['Cancellation rate', fmtPct(k.cancellationRate)],
        ['Avg gate-to-gate turnaround', fmtMin(k.avgTurnaroundMinutes)],
        ['Avg yard wait / dock time', `${fmtMin(k.avgYardWaitMinutes)} / ${fmtMin(k.avgDockMinutes)}`],
        ['Pallets handled', String(k.palletsHandled)],
        ['Busiest hours', data.busiestHours.slice(0, 3).map((h) => `${h.label} (${h.count})`).join(', ')],
      ],
      headers: ['Carrier', 'Appts', 'Completed', 'On time', 'Late', 'No-shows', 'Cancelled', 'On-time %', 'Avg delay', 'Reliability'],
      rows: data.carriers.map((c) => [c.name, c.appointments, c.completed, c.onTime, c.late, c.noShows, c.cancelled, fmtPct(c.onTimeRate), fmtMin(c.avgLateMinutes), c.reliabilityScore != null ? `${c.reliabilityScore} (${c.tier})` : 'New']),
    });
  };

  const heatMax = data ? Math.max(1, ...data.heatmap.flat()) : 1;
  const hours = data
    ? (() => {
        const used = data.heatmap.flatMap((row) => row.map((v, h) => (v > 0 ? h : -1))).filter((h) => h >= 0);
        const lo = used.length ? Math.min(...used) : 7;
        const hi = used.length ? Math.max(...used) : 18;
        return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
      })()
    : [];
  const dailyMax = data ? Math.max(1, ...data.daily.map((d) => d.total)) : 1;

  return (
    <div className="space-y-6">
      <Card
        title="Dock operations KPIs"
        actions={
          <>
            {[7, 30, 90].map((d) => (
              <Button key={d} size="sm" onClick={() => preset(d)}>Last {d} days</Button>
            ))}
            <Button size="sm" onClick={exportCsv} disabled={!data}>Export CSV</Button>
            <Button size="sm" variant="primary" onClick={exportPdf} disabled={!data}>Export PDF report</Button>
          </>
        }
      >
        <div className="flex flex-wrap gap-3 mb-5">
          <Field label="From"><input type="date" className={inputClass} value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
          <Field label="To"><input type="date" className={inputClass} value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
        </div>

        {isLoading ? (
          <Empty>Crunching numbers…</Empty>
        ) : isError || !data ? (
          <Empty>Could not load analytics.</Empty>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Appointments" value={data.kpis.totalAppointments} hint={`${data.kpis.avgDailyAppointments} per day`} />
            <Stat label="Dock utilization" value={fmtPct(data.kpis.dockUtilization)} hint={`of ${data.kpis.offeredCapacity} offered truck-slots`} />
            <Stat label="On-time arrivals" value={fmtPct(data.kpis.onTimeRate)} hint={`late = > ${warehouse.lateThresholdMinutes} min after slot start`} tone="good" />
            <Stat label="No-show rate" value={fmtPct(data.kpis.noShowRate)} tone={(data.kpis.noShowRate ?? 0) > 10 ? 'bad' : 'warn'} />
            <Stat label="Avg turnaround" value={fmtMin(data.kpis.avgTurnaroundMinutes)} hint="gate check-in → departure" />
            <Stat label="Avg yard wait" value={fmtMin(data.kpis.avgYardWaitMinutes)} hint="gate → dock door" />
            <Stat label="Avg dock time" value={fmtMin(data.kpis.avgDockMinutes)} hint="loading / unloading" />
            <Stat label="Pallets handled" value={data.kpis.palletsHandled.toLocaleString()} hint={`cancellation rate ${fmtPct(data.kpis.cancellationRate)}`} />
          </div>
        )}
      </Card>

      {data && (
        <>
          <div className="grid lg:grid-cols-3 gap-6">
            <Card title="Daily appointment volume" className="lg:col-span-2">
              {data.daily.length === 0 ? (
                <Empty>No data</Empty>
              ) : (
                <div className="relative" data-chart>
                  <div className="flex items-end gap-[2px] h-44 border-b border-slate-700">
                    {data.daily.map((d) => (
                      <div
                        key={d.date}
                        className="flex-1 h-full flex items-end outline-none"
                        {...daily.bind(
                          <>
                            <b>{d.date}</b>: {d.total} appointments · {d.completed} completed · {d.noShow} no-show · {d.cancelled} cancelled
                          </>
                        )}
                      >
                        <div className="w-full hover:brightness-125" style={{ height: `${(d.total / dailyMax) * 100}%`, background: SERIES, borderRadius: '4px 4px 0 0', minHeight: d.total ? 2 : 0 }} />
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                    <span>{data.daily[0]?.date}</span>
                    <span>peak {dailyMax} / day</span>
                    <span>{data.daily[data.daily.length - 1]?.date}</span>
                  </div>
                  {daily.node}
                </div>
              )}
            </Card>

            <Card title="Busiest hours (site time)">
              {data.busiestHours.length === 0 ? (
                <Empty>No data</Empty>
              ) : (
                <BarList rows={data.busiestHours.map((h) => ({ label: `${h.label}–${String(h.hour + 1).padStart(2, '0')}:00`, value: h.count, display: String(h.count), detail: 'appointments' }))} />
              )}
              <p className="text-[11px] text-slate-500 mt-3">Use this to plan labour shifts and to steer carriers toward off-peak slots.</p>
            </Card>
          </div>

          <Card title="Demand heatmap · appointments by weekday and hour">
            <div className="relative overflow-x-auto" data-chart>
              <table className="border-separate" style={{ borderSpacing: 2 }}>
                <thead>
                  <tr>
                    <th />
                    {hours.map((h) => (
                      <th key={h} className="text-[10px] font-medium text-slate-500 px-1">{String(h).padStart(2, '0')}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
                    <tr key={wd}>
                      <th className="text-[11px] font-medium text-slate-400 pr-2 text-right">{WEEKDAYS[wd]}</th>
                      {hours.map((h) => {
                        const v = data.heatmap[wd][h];
                        const step = v === 0 ? -1 : Math.min(SEQ.length - 1, Math.floor((v / heatMax) * (SEQ.length - 1)));
                        return (
                          <td
                            key={h}
                            className="w-9 h-7 rounded outline-none"
                            style={{ background: step < 0 ? '#1e293b' : SEQ[step] }}
                            {...heat.bind(<><b>{WEEKDAYS[wd]} {String(h).padStart(2, '0')}:00</b>: {v} appointments</>)}
                          />
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center gap-2 mt-3 text-[10px] text-slate-500">
                <span>0</span>
                <div className="flex gap-[2px]">
                  {['#1e293b', ...SEQ].map((c) => <span key={c} className="w-5 h-3 rounded-sm" style={{ background: c }} />)}
                </div>
                <span>{heatMax} appointments per hour-of-week</span>
              </div>
              {heat.node}
            </div>
          </Card>

          <div className="grid lg:grid-cols-3 gap-6">
            <Card title="Dock utilization" className="lg:col-span-2">
              <BarList
                max={100}
                rows={data.perDock.map((d) => ({
                  label: d.dockName,
                  value: d.utilization ?? 0,
                  display: fmtPct(d.utilization),
                  detail: `${d.appointments} of ${d.capacity} truck-slots · avg dock time ${fmtMin(d.avgDockMinutes)}`,
                }))}
              />
              <p className="text-[11px] text-slate-500 mt-3">Utilization = booked truck-slots ÷ offered truck-slots (slots × capacity, excluding maintenance and closures).</p>
            </Card>
            <Card title="Load mix">
              <p className="text-[11px] uppercase font-bold text-slate-500 mb-2">Movement</p>
              <BarList rows={Object.entries(data.byDirection).map(([k, v]) => ({ label: k === 'INBOUND' ? 'Inbound (receiving)' : 'Outbound (shipping)', value: v, display: String(v) }))} />
              <p className="text-[11px] uppercase font-bold text-slate-500 mb-2 mt-5">Equipment</p>
              <BarList rows={Object.entries(data.byTrailerType).map(([k, v]) => ({ label: TRAILER_LABEL[k as TrailerType] ?? k, value: v, display: String(v) }))} />
            </Card>
          </div>

          <Card title="Carrier performance in this period">
            {data.carriers.length === 0 ? (
              <Empty>No carrier activity in this period.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[820px]">
                  <thead className="text-left text-[11px] uppercase text-slate-500 border-b border-slate-800">
                    <tr><th className="py-2">Carrier</th><th>Appts</th><th>Completed</th><th>On-time %</th><th>Late</th><th>No-shows</th><th>Cancelled</th><th>Avg delay</th><th>Pallets</th><th>Reliability</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {data.carriers.map((c) => (
                      <tr key={c.vendorId}>
                        <td className="py-2.5 font-medium">{c.name}</td>
                        <td>{c.appointments}</td>
                        <td>{c.completed}</td>
                        <td>{fmtPct(c.onTimeRate)}</td>
                        <td>{c.late}</td>
                        <td>{c.noShows}</td>
                        <td>{c.cancelled}</td>
                        <td>{fmtMin(c.avgLateMinutes)}</td>
                        <td>{c.pallets.toLocaleString()}</td>
                        <td><TierBadge score={{ reliabilityScore: c.reliabilityScore, tier: c.tier, tierLabel: c.tierLabel } as CarrierScore} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
};
