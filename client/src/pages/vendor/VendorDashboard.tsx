import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api';
import { format, parseISO } from 'date-fns';
import { BookingStatusBadge } from '../../components/BookingStatusBadge';
import { WarehouseAccessPanel } from '../../components/vendor/WarehouseAccessPanel';

interface Booking {
  _id: string;
  dockId: {
    _id: string;
    dockName: string;
  } | null;
  // warehouseId is populated by the backend; it may be an object or a bare string id
  warehouseId: {
    _id: string;
    name: string;
    address: string;
    timezone?: string;
  } | null;
  truckNumber: string;
  driverName: string;
  driverPhone: string;
  startTime: string;
  endTime: string;
  status: 'PENDING' | 'APPROVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'REJECTED';
}

export const VendorDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Fetch Vendor's own bookings (warehouseId is populated via backend fix)
  const { data: bookings = [], isLoading, refetch } = useQuery<Booking[]>({
    queryKey: ['vendorBookings'],
    queryFn: async () => {
      const res = await api.get('/api/bookings');
      return res.data.bookings;
    },
  });

  // Cancel mutation with confirmation prompt
  const cancelMutation = useMutation({
    mutationFn: async (id: string) =>
      api.patch(`/api/bookings/${id}/status`, { status: 'CANCELLED' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vendorBookings'] }),
  });

  const handleCancel = (id: string) => {
    if (window.confirm('Cancel this booking? This cannot be undone.')) {
      cancelMutation.mutate(id);
    }
  };

  // Format a UTC ISO string to local time with timezone abbreviation
  const formatLocalTime = (utcStr: string) => {
    try {
      const date = parseISO(utcStr);
      const timeStr = format(date, 'MMM d, yyyy • hh:mm a');
      const tzAbbr = new Intl.DateTimeFormat('en', { timeZoneName: 'short' })
        .formatToParts(date)
        .find((p) => p.type === 'timeZoneName')?.value ?? '';
      return `${timeStr} ${tzAbbr}`.trim();
    } catch {
      return utcStr;
    }
  };

  // Helper to resolve warehouse name/address from a possibly-populated or bare id field
  const resolveWarehouse = (w: Booking['warehouseId']) => {
    if (!w) return { name: 'N/A', address: 'N/A' };
    if (typeof w === 'object' && w.name) return { name: w.name, address: w.address };
    return { name: 'N/A', address: 'N/A' };
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-6 lg:p-8">
      {/* Header */}
      <header className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between border-b border-slate-800 pb-6 mb-8 gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-purple-400">Carrier Portal</span>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-slate-100 to-slate-400 bg-clip-text text-transparent mt-1">
            {user?.vendorCompany || 'Vendor Dashboard'}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Logged in as: <span className="text-slate-200">{user?.username} ({user?.email})</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/vendor/book')}
            className="py-2.5 px-5 rounded-xl bg-purple-600 hover:bg-purple-500 text-sm font-bold text-white transition-all cursor-pointer shadow-lg shadow-purple-900/20 active:scale-98"
          >
            + Book Dock Slot
          </button>
          <button
            onClick={logout}
            className="py-2.5 px-4 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-sm font-semibold transition-all cursor-pointer shadow-md"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto">
        <WarehouseAccessPanel />

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              My Scheduled Bookings
            </h2>
            <button
              onClick={() => refetch()}
              className="text-xs text-purple-400 hover:text-purple-300 font-semibold cursor-pointer"
            >
              Refresh List
            </button>
          </div>

          {isLoading ? (
            <p className="text-sm text-slate-500 text-center py-12">Loading bookings...</p>
          ) : bookings.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 bg-slate-950 border border-slate-800 rounded-2xl flex items-center justify-center text-slate-600 mx-auto mb-4">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-md font-bold text-slate-300">No Bookings Found</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                You haven't scheduled any dock arrivals yet. Click "Book Dock Slot" to reserve a timeslot.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-950 text-slate-400 text-xs uppercase font-bold tracking-wider">
                  <tr>
                    <th className="p-3 rounded-l-xl">Date &amp; Time</th>
                    <th className="p-3">Warehouse / Address</th>
                    <th className="p-3">Dock</th>
                    <th className="p-3">Truck &amp; Driver</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 rounded-r-xl text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {bookings.map((booking) => {
                    const wh = resolveWarehouse(booking.warehouseId);
                    return (
                      <tr key={booking._id} className="hover:bg-slate-800/35 transition-colors">
                        <td className="p-3 font-semibold text-slate-200 whitespace-nowrap">
                          {formatLocalTime(booking.startTime)}<br />
                          <span className="text-xs font-normal text-slate-500">
                            → {formatLocalTime(booking.endTime)}
                          </span>
                        </td>
                        <td className="p-3">
                          <p className="font-semibold text-slate-200">{wh.name}</p>
                          <p className="text-xs text-slate-500">{wh.address}</p>
                        </td>
                        <td className="p-3 font-semibold text-purple-400">{booking.dockId?.dockName || 'N/A'}</td>
                        <td className="p-3">
                          <p className="text-slate-200">Truck: <span className="font-semibold">{booking.truckNumber}</span></p>
                          <p className="text-xs text-slate-400">{booking.driverName} ({booking.driverPhone})</p>
                        </td>
                        <td className="p-3">
                          <div className="flex flex-col items-start gap-1">
                            <BookingStatusBadge status={booking.status} />
                            {booking.status === 'REJECTED' && (
                              <span className="text-[10px] text-red-400 max-w-[150px] leading-tight">
                                Reason: Request rejected by warehouse administrator.
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3 text-right">
                          {(booking.status === 'PENDING' || booking.status === 'APPROVED') && (
                            <button
                              onClick={() => handleCancel(booking._id)}
                              disabled={cancelMutation.isPending}
                              className="py-1 px-2.5 rounded bg-slate-800 hover:bg-red-950 border border-slate-700 hover:border-red-800 text-xs text-slate-400 hover:text-red-400 transition-all cursor-pointer disabled:opacity-40"
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
