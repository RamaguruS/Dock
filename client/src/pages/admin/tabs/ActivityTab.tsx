import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api';
import { Button, Card, Chip, Empty, inputClass } from '../../../components/ui';
import { fmtDateTime } from '../../../lib/format';
import { downloadCsv } from '../../../lib/export';
import { type Warehouse } from '../types';

interface AuditLog {
  _id: string;
  actorRole?: string;
  actorName?: string;
  action: string;
  entityType: string;
  message: string;
  createdAt: string;
}

interface AuditResponse {
  logs: AuditLog[];
  total: number;
  page: number;
  pages: number;
  actions: string[];
}

const actionTone = (action: string) => {
  if (/CANCEL|REJECT|NO_SHOW|DEACTIVATED|EXPIRED|REMOVED/.test(action)) return '!bg-red-950/60 !text-red-300 !border-red-800/50';
  if (/APPROVED|COMPLETED|AUTO_ASSIGNED/.test(action)) return '!bg-emerald-950/60 !text-emerald-300 !border-emerald-800/50';
  if (/MAINTENANCE|BLACKOUT|SETTINGS|HOURS|DOCK_/.test(action)) return '!bg-sky-950/60 !text-sky-300 !border-sky-800/50';
  return '';
};

export const ActivityTab: React.FC<{ warehouse: Warehouse }> = ({ warehouse }) => {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery<AuditResponse>({
    queryKey: ['audit', page, action, search],
    queryFn: async () =>
      (await api.get(`/api/audit-logs?page=${page}&limit=40&action=${encodeURIComponent(action)}&search=${encodeURIComponent(search)}`)).data,
    refetchInterval: 15000,
  });

  return (
    <Card
      title={`Activity log${data ? ` (${data.total} events)` : ''}`}
      actions={
        <Button
          size="sm"
          disabled={!data?.logs.length}
          onClick={() =>
            downloadCsv('activity-log.csv', ['Time', 'Actor', 'Role', 'Action', 'Details'], (data?.logs ?? []).map((l) => [fmtDateTime(l.createdAt, warehouse.timezone), l.actorName, l.actorRole, l.action, l.message]))
          }
        >
          Export page CSV
        </Button>
      }
    >
      <p className="text-xs text-slate-500 mb-4">
        Every change to appointments, docks, rules and carrier access is recorded with who did it and when, including automatic actions
        (no-shows, expiries, waitlist assignment). Use it for dispute resolution and compliance.
      </p>
      <div className="flex flex-wrap gap-2 mb-4">
        <select className={`${inputClass} !w-auto`} value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="Filter by action">
          <option value="">All actions</option>
          {data?.actions.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ').toLowerCase()}</option>)}
        </select>
        <input className={`${inputClass} !w-64`} placeholder="Search truck, carrier, dock…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>

      {isLoading ? (
        <Empty>Loading…</Empty>
      ) : !data?.logs.length ? (
        <Empty>No activity recorded.</Empty>
      ) : (
        <>
          <ul className="divide-y divide-slate-800">
            {data.logs.map((l) => (
              <li key={l._id} className="py-3 flex flex-col md:flex-row md:items-start gap-2 md:gap-4 text-sm">
                <span className="text-xs text-slate-500 md:w-36 shrink-0">{fmtDateTime(l.createdAt, warehouse.timezone)}</span>
                <Chip className={`w-fit shrink-0 ${actionTone(l.action)}`}>{l.action.replace(/_/g, ' ')}</Chip>
                <span className="flex-1 text-slate-200">{l.message}</span>
                <span className="text-xs text-slate-400 md:text-right md:w-48 shrink-0">
                  {l.actorName ?? 'System'}
                  {l.actorRole && <span className="block text-[10px] text-slate-500">{l.actorRole === 'VENDOR' ? 'Carrier' : l.actorRole === 'SYSTEM' ? 'Automation' : 'Warehouse'}</span>}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between mt-4 text-xs text-slate-400">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Newer</Button>
            <span>Page {data.page} of {Math.max(1, data.pages)}</span>
            <Button size="sm" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>Older →</Button>
          </div>
        </>
      )}
    </Card>
  );
};
