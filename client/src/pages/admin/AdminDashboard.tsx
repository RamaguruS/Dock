import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { AppHeader } from '../../components/AppHeader';
import { Alert, Tabs } from '../../components/ui';
import { tzAbbrev } from '../../lib/format';
import { type Warehouse } from './types';
import { YardTab } from './tabs/YardTab';
import { DocksTab } from './tabs/DocksTab';
import { CarriersTab } from './tabs/CarriersTab';
import { AnalyticsTab } from './tabs/AnalyticsTab';
import { ActivityTab } from './tabs/ActivityTab';
import { SettingsTab } from './tabs/SettingsTab';

export const AdminDashboard: React.FC = () => {
  const [tab, setTab] = useState('yard');
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const notify = (kind: 'success' | 'error', text: string) => setMessage({ kind, text });

  const { data: warehouse, isLoading } = useQuery<Warehouse>({
    queryKey: ['warehouse'],
    queryFn: async () => (await api.get('/api/warehouses/my')).data.warehouse,
  });
  const { data: pendingCount = 0 } = useQuery<number>({
    queryKey: ['pendingVendors', 'count'],
    queryFn: async () => (await api.get('/api/vendors/pending')).data.vendors.length,
    refetchInterval: 30000,
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-6 lg:p-8">
      <AppHeader
        eyebrow="Dock & yard control tower"
        title={warehouse?.name ?? 'SmartDock'}
        subtitle={
          warehouse && (
            <>
              {warehouse.address} · Site time {tzAbbrev(warehouse.timezone)} ({warehouse.timezone}) · {warehouse.slotDurationMinutes}-min slots
              {warehouse.bufferMinutes ? ` + ${warehouse.bufferMinutes}-min buffer` : ''}
            </>
          )
        }
      />

      <main className="max-w-7xl mx-auto">
        <Tabs
          tabs={[
            { id: 'yard', label: 'Yard schedule' },
            { id: 'docks', label: 'Docks & maintenance' },
            { id: 'carriers', label: 'Carriers & waitlist', badge: pendingCount },
            { id: 'analytics', label: 'Analytics & KPIs' },
            { id: 'activity', label: 'Activity log' },
            { id: 'settings', label: 'Scheduling rules' },
          ]}
          active={tab}
          onChange={(t) => {
            setTab(t);
            setMessage(null);
          }}
        />

        {message && (
          <div className="mb-5">
            <Alert kind={message.kind} onClose={() => setMessage(null)}>
              {message.text}
            </Alert>
          </div>
        )}

        {isLoading || !warehouse ? (
          <p className="text-slate-500 text-sm">Loading warehouse…</p>
        ) : (
          <>
            {tab === 'yard' && <YardTab warehouse={warehouse} notify={notify} />}
            {tab === 'docks' && <DocksTab warehouse={warehouse} notify={notify} />}
            {tab === 'carriers' && <CarriersTab warehouse={warehouse} notify={notify} />}
            {tab === 'analytics' && <AnalyticsTab warehouse={warehouse} />}
            {tab === 'activity' && <ActivityTab warehouse={warehouse} />}
            {tab === 'settings' && <SettingsTab warehouse={warehouse} notify={notify} />}
          </>
        )}
      </main>
    </div>
  );
};
