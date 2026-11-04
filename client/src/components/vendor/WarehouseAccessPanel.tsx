import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useVendorAccess, VENDOR_ACCESS_QUERY_KEY, type AccessStatus } from '../../hooks/useVendorAccess';

interface WarehouseOption {
  _id: string;
  name: string;
  address: string;
}

const ACCESS_STYLES: Record<AccessStatus, string> = {
  PENDING: 'bg-amber-950 text-amber-400 border-amber-500/20',
  APPROVED: 'bg-green-950 text-green-400 border-green-500/20',
  REJECTED: 'bg-red-950 text-red-400 border-red-500/20',
};

export const WarehouseAccessPanel: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: access = [], isLoading } = useVendorAccess();

  const { data: warehouses = [] } = useQuery<WarehouseOption[]>({
    queryKey: ['public-warehouses'],
    queryFn: async () => (await api.get('/api/warehouses')).data.warehouses,
  });

  const requestMutation = useMutation({
    mutationFn: async (warehouseId: string) => api.post('/api/vendors/me/access', { warehouseId }),
    onSuccess: () => {
      setSelectedWarehouseId('');
      setErrorMsg(null);
      queryClient.invalidateQueries({ queryKey: VENDOR_ACCESS_QUERY_KEY });
    },
    onError: (err: any) => {
      const error = err.response?.data?.error;
      setErrorMsg(typeof error === 'string' ? error : 'Could not send the request.');
    },
  });

  const requestedIds = new Set(access.map((a) => a.warehouseId._id));
  const requestable = warehouses.filter((w) => !requestedIds.has(w._id));

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl mb-8">
      <h2 className="text-lg font-bold text-slate-100">Warehouse Access</h2>
      <p className="text-xs text-slate-500 mt-1">
        You can book only at warehouses that have approved your account.
      </p>

      {isLoading ? (
        <p className="text-sm text-slate-500 py-4">Loading access...</p>
      ) : access.length === 0 ? (
        <p className="text-sm text-slate-400 py-4">You haven't requested access to any warehouse yet.</p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {access.map((a) => (
            <li
              key={a._id}
              className="flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 p-3"
            >
              <div>
                <p className="text-sm font-semibold text-slate-200">{a.warehouseId.name}</p>
                <p className="text-xs text-slate-500">{a.warehouseId.address}</p>
              </div>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${ACCESS_STYLES[a.status]}`}
              >
                {a.status}
              </span>
            </li>
          ))}
        </ul>
      )}

      {requestable.length > 0 && (
        <form
          className="mt-4 flex flex-col sm:flex-row gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (selectedWarehouseId) requestMutation.mutate(selectedWarehouseId);
          }}
        >
          <label htmlFor="request-warehouse" className="sr-only">
            Warehouse to request
          </label>
          <select
            id="request-warehouse"
            value={selectedWarehouseId}
            onChange={(e) => setSelectedWarehouseId(e.target.value)}
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl py-2.5 px-3 text-sm text-slate-100 focus:outline-none focus:border-purple-500"
          >
            <option value="">Request access to another warehouse...</option>
            {requestable.map((w) => (
              <option key={w._id} value={w._id}>
                {w.name} — {w.address}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!selectedWarehouseId || requestMutation.isPending}
            className="py-2.5 px-5 rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700 text-sm font-semibold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {requestMutation.isPending ? 'Requesting...' : 'Request Access'}
          </button>
        </form>
      )}
      {errorMsg && <p className="mt-2 text-xs text-red-400 font-medium">{errorMsg}</p>}
    </div>
  );
};
