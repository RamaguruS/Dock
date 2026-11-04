import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { type Booking, STATUS_LABEL, TRAILER_LABEL, fmtDate, fmtTime, localDateKey, todayKey } from '../../lib/format';
import { type Warehouse } from './types';

/** Printable daily gate / security sheet (Print → Save as PDF). */
export const GateSheet: React.FC = () => {
  const [params] = useSearchParams();

  const { data: warehouse } = useQuery<Warehouse>({
    queryKey: ['warehouse'],
    queryFn: async () => (await api.get('/api/warehouses/my')).data.warehouse,
  });
  const tz = warehouse?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dateKey = params.get('date') ?? todayKey(tz);

  const { data: raw = [], isLoading } = useQuery<Booking[]>({
    queryKey: ['gateSheet', dateKey],
    queryFn: async () => {
      const base = new Date(`${dateKey}T00:00:00Z`).getTime();
      const from = new Date(base - 15 * 3600000).toISOString();
      const to = new Date(base + 39 * 3600000).toISOString();
      return (await api.get(`/api/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).data.bookings;
    },
    enabled: !!warehouse,
  });

  const rows = useMemo(
    () => raw.filter((b) => localDateKey(b.startTime, tz) === dateKey && !['CANCELLED', 'REJECTED'].includes(b.status)),
    [raw, tz, dateKey]
  );

  return (
    <div className="min-h-screen bg-white text-black p-8 print:p-0 font-sans">
      <style>{`@media print { @page { size: A4 landscape; margin: 10mm; } .no-print { display: none !important; } }`}</style>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Gate schedule — {warehouse?.name}</h1>
          <p className="text-sm text-gray-600">
            {fmtDate(`${dateKey}T12:00:00Z`, 'UTC')} · {warehouse?.address} · times in site time ({tz})
          </p>
          <p className="text-sm text-gray-600">{rows.length} expected trucks · printed {new Date().toLocaleString()}</p>
        </div>
        <div className="no-print flex gap-2">
          <button className="px-4 py-2 rounded bg-purple-700 text-white font-semibold cursor-pointer" onClick={() => window.print()}>
            Print / Save as PDF
          </button>
          <button className="px-4 py-2 rounded border border-gray-400 cursor-pointer" onClick={() => window.close()}>
            Close
          </button>
        </div>
      </div>

      {isLoading ? (
        <p>Loading…</p>
      ) : (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-100">
              {['Slot', 'Dock', 'Carrier', 'Truck no.', 'Driver', 'Phone', 'Load', 'PO / ASN', 'Pallets', 'Status', 'Gate in', 'Gate out', 'Seal no.', 'Sign'].map((h) => (
                <th key={h} className="border border-gray-400 px-1.5 py-1 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b._id} className="break-inside-avoid">
                <td className="border border-gray-400 px-1.5 py-2 font-semibold whitespace-nowrap">{fmtTime(b.startTime, tz)}–{fmtTime(b.endTime, tz)}</td>
                <td className="border border-gray-400 px-1.5">{b.dockId?.dockName}</td>
                <td className="border border-gray-400 px-1.5">{b.vendorId?.vendorCompany}</td>
                <td className="border border-gray-400 px-1.5 font-mono whitespace-nowrap">{b.truckNumber}</td>
                <td className="border border-gray-400 px-1.5">{b.driverName}</td>
                <td className="border border-gray-400 px-1.5 whitespace-nowrap">{b.driverPhone}</td>
                <td className="border border-gray-400 px-1.5">
                  {b.direction === 'INBOUND' ? 'IN' : 'OUT'} · {TRAILER_LABEL[b.trailerType]}
                  {b.hazmat && <b> · HAZMAT</b>}
                </td>
                <td className="border border-gray-400 px-1.5">{b.referenceNumber}</td>
                <td className="border border-gray-400 px-1.5 text-center">{b.palletCount ?? ''}</td>
                <td className="border border-gray-400 px-1.5">{STATUS_LABEL[b.status]}</td>
                <td className="border border-gray-400 px-1.5 w-16">{b.checkedInAt ? fmtTime(b.checkedInAt, tz) : ''}</td>
                <td className="border border-gray-400 px-1.5 w-16">{b.completedAt ? fmtTime(b.completedAt, tz) : ''}</td>
                <td className="border border-gray-400 px-1.5 w-20" />
                <td className="border border-gray-400 px-1.5 w-20" />
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={14} className="border border-gray-400 p-4 text-center text-gray-500">No trucks expected on this day.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      <p className="text-[10px] text-gray-500 mt-4">
        Gate staff: verify truck number and driver ID against this sheet, record gate in/out times and seal numbers. Hazmat loads must be directed
        to the hazmat-certified bay only.
      </p>
    </div>
  );
};
