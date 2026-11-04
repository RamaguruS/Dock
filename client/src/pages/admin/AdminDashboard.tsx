import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api';
import { format, parseISO, startOfDay, endOfDay } from 'date-fns';
import { BookingCalendar } from '../../components/dashboard/BookingCalendar';
import { BookingStatusBadge } from '../../components/BookingStatusBadge';

interface Dock {
  _id: string;
  dockName: string;
  maxCapacityPerHour: number;
  isActive: boolean;
}

interface OperatingHour {
  day: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
  start: string;
  end: string;
  isOpen: boolean;
}

interface Warehouse {
  _id: string;
  name: string;
  address: string;
  operatingHours: OperatingHour[];
  timezone: string;
}

interface Booking {
  _id: string;
  dockId: {
    _id: string;
    dockName: string;
  } | null;
  vendorId: {
    _id: string;
    username: string;
    email: string;
    vendorCompany: string;
  } | null;
  truckNumber: string;
  driverName: string;
  driverPhone: string;
  startTime: string;
  endTime: string;
  status: 'PENDING' | 'APPROVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'REJECTED';
}

export const AdminDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Stateful selected date (Date object) for calendar + bookings query
  const [selectedDate, setSelectedDate] = useState<Date>(startOfDay(new Date()));

  // Modal / Form States
  const [isDockModalOpen, setIsDockModalOpen] = useState(false);
  const [dockForm, setDockForm] = useState({ id: '', name: '', capacity: 1, isActive: true });
  const [hoursForm, setHoursForm] = useState<OperatingHour[]>([]);

  // ----------------------------------------------------
  // Queries
  // ----------------------------------------------------
  
  // Docks Query
  const { data: docks = [], isLoading: docksLoading } = useQuery<Dock[]>({
    queryKey: ['docks'],
    queryFn: async () => {
      const res = await api.get('/api/docks');
      return res.data.docks;
    },
  });

  // Warehouse Profile (Operating Hours) Query
  const { data: warehouse, isLoading: warehouseLoading } = useQuery<Warehouse>({
    queryKey: ['warehouse'],
    queryFn: async () => {
      const res = await api.get('/api/warehouses/my');
      if (res.data.warehouse && hoursForm.length === 0) {
        setHoursForm(res.data.warehouse.operatingHours);
      }
      return res.data.warehouse;
    },
  });

  // Pending Vendors Query
  const { data: pendingVendors = [], isLoading: vendorsLoading } = useQuery<any[]>({
    queryKey: ['pendingVendors'],
    queryFn: async () => {
      const res = await api.get('/api/vendors/pending');
      return res.data.vendors;
    },
  });

  // Live Bookings Query scoped to selectedDate UTC range (Polls every 10s)
  const { data: bookings = [], isLoading: bookingsLoading } = useQuery<Booking[]>({
    queryKey: ['bookings', selectedDate.toISOString()],
    queryFn: async () => {
      const from = startOfDay(selectedDate).toISOString();
      const to   = endOfDay(selectedDate).toISOString();
      const res = await api.get(`/api/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      return res.data.bookings;
    },
    refetchInterval: 10000, // Poll every 10s
  });

  // ----------------------------------------------------
  // Mutations
  // ----------------------------------------------------

  // Dock Create/Update Mutation
  const saveDockMutation = useMutation({
    mutationFn: async (data: { id?: string; dockName: string; maxCapacityPerHour: number; isActive: boolean }) => {
      if (data.id) {
        return api.put(`/api/docks/${data.id}`, {
          dockName: data.dockName,
          maxCapacityPerHour: data.maxCapacityPerHour,
          isActive: data.isActive,
        });
      } else {
        return api.post('/api/docks', {
          dockName: data.dockName,
          maxCapacityPerHour: data.maxCapacityPerHour,
          isActive: data.isActive,
        });
      }
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['docks'] });
      setSuccessMsg(res.data.message || 'Dock saved successfully');
      setIsDockModalOpen(false);
      setDockForm({ id: '', name: '', capacity: 1, isActive: true });
    },
    onError: (err: any) => {
      setErrorMsg(err.response?.data?.error || 'Failed to save dock');
    },
  });

  // Dock Deactivate Mutation
  const deactivateDockMutation = useMutation({
    mutationFn: async (id: string) => {
      return api.patch(`/api/docks/${id}/deactivate`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docks'] });
      setSuccessMsg('Dock deactivated successfully');
    },
    onError: (err: any) => {
      setErrorMsg(err.response?.data?.error || 'Failed to deactivate dock');
    },
  });

  // Operating Hours Mutation
  const saveHoursMutation = useMutation({
    mutationFn: async (hours: OperatingHour[]) => {
      return api.put('/api/warehouses/operating-hours', { operatingHours: hours });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouse'] });
      setSuccessMsg('Operating hours updated successfully');
    },
    onError: (err: any) => {
      setErrorMsg(err.response?.data?.error || 'Failed to update operating hours');
    },
  });

  // Vendor Approval Mutation
  const approveVendorMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'APPROVED' | 'REJECTED' }) => {
      return api.patch(`/api/vendors/${id}/status`, { status });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['pendingVendors'] });
      setSuccessMsg(`Vendor access to your warehouse has been ${variables.status.toLowerCase()}`);
    },
    onError: (err: any) => {
      setErrorMsg(err.response?.data?.error || 'Failed to update vendor status');
    },
  });

  // Booking Status Change Mutation
  const updateBookingStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return api.patch(`/api/bookings/${id}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      setSuccessMsg('Booking status updated successfully');
    },
    onError: (err: any) => {
      setErrorMsg(err.response?.data?.error || 'Failed to update booking status');
    },
  });

  // ----------------------------------------------------
  // Helpers
  // ----------------------------------------------------
  const formatLocalTime = (utcStr: string) => {
    try {
      const date = parseISO(utcStr);
      const timeStr = format(date, 'hh:mm a');
      // Append short timezone abbreviation from browser locale
      const tzAbbr = new Intl.DateTimeFormat('en', { timeZoneName: 'short' })
        .formatToParts(date)
        .find((p) => p.type === 'timeZoneName')?.value ?? '';
      return `${timeStr} ${tzAbbr}`.trim();
    } catch {
      return utcStr;
    }
  };

  const handleHoursChange = (index: number, field: keyof OperatingHour, value: any) => {
    const updated = [...hoursForm];
    updated[index] = { ...updated[index], [field]: value };
    setHoursForm(updated);
  };

  const openAddDock = () => {
    setDockForm({ id: '', name: '', capacity: 1, isActive: true });
    setIsDockModalOpen(true);
  };

  const openEditDock = (dock: Dock) => {
    setDockForm({ id: dock._id, name: dock.dockName, capacity: dock.maxCapacityPerHour, isActive: dock.isActive });
    setIsDockModalOpen(true);
  };

  const handleSaveDockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveDockMutation.mutate({
      id: dockForm.id || undefined,
      dockName: dockForm.name,
      maxCapacityPerHour: dockForm.capacity,
      isActive: dockForm.isActive,
    });
  };

  const clearMessages = () => {
    setSuccessMsg(null);
    setErrorMsg(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-6 lg:p-8">
      {/* Header */}
      <header className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between border-b border-slate-800 pb-6 mb-8 gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-purple-400">Control Panel</span>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-slate-100 to-slate-400 bg-clip-text text-transparent mt-1">
            {warehouse?.name || 'SmartDock'} Admin
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Location: <span className="text-slate-200">{warehouse?.address}</span> • Timezone: <span className="text-slate-200">{warehouse?.timezone}</span>
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm font-semibold">{user?.username}</p>
            <p className="text-xs text-slate-400">{user?.role}</p>
          </div>
          <button
            onClick={logout}
            className="py-2.5 px-4 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-sm font-semibold transition-all cursor-pointer shadow-md"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Global Alerts */}
      {(successMsg || errorMsg) && (
        <div className="max-w-7xl mx-auto mb-6">
          {successMsg && (
            <div className="p-4 bg-green-950/50 border border-green-500/30 rounded-xl text-green-400 text-sm flex justify-between items-center animate-fade-in">
              <span>{successMsg}</span>
              <button onClick={clearMessages} className="text-green-400 hover:text-green-200 font-bold">&times;</button>
            </div>
          )}
          {errorMsg && (
            <div className="p-4 bg-red-950/50 border border-red-500/30 rounded-xl text-red-400 text-sm flex justify-between items-center animate-fade-in">
              <span>{errorMsg}</span>
              <button onClick={clearMessages} className="text-red-400 hover:text-red-200 font-bold">&times;</button>
            </div>
          )}
        </div>
      )}

      <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Dock Management & Operating Hours */}
        <div className="lg:col-span-1 space-y-8">
          
          {/* Dock Management Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2" />
                </svg>
                Dock Assets
              </h2>
              <button
                onClick={openAddDock}
                className="py-1.5 px-3 rounded-lg bg-purple-600 hover:bg-purple-500 text-xs font-bold transition-all cursor-pointer"
              >
                + Add Dock
              </button>
            </div>

            {docksLoading ? (
              <p className="text-sm text-slate-500 text-center py-6">Loading docks...</p>
            ) : docks.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">No docks configured yet.</p>
            ) : (
              <div className="divide-y divide-slate-800">
                {docks.map((dock) => (
                  <div key={dock._id} className="py-3 flex items-center justify-between first:pt-0 last:pb-0">
                    <div>
                      <p className="text-sm font-semibold">{dock.dockName}</p>
                      <p className="text-xs text-slate-400">Cap: {dock.maxCapacityPerHour} truck/hr</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${dock.isActive ? 'bg-green-950 text-green-400 border border-green-500/20' : 'bg-red-950 text-red-400 border border-red-500/20'}`}>
                        {dock.isActive ? 'Active' : 'Inactive'}
                      </span>
                      <button
                        onClick={() => openEditDock(dock)}
                        className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-100 transition-all text-xs"
                        title="Edit Dock"
                      >
                        Edit
                      </button>
                      {dock.isActive && (
                        <button
                          onClick={() => deactivateDockMutation.mutate(dock._id)}
                          className="p-1.5 rounded bg-red-950/40 hover:bg-red-900/40 text-red-400 hover:text-red-300 transition-all text-xs"
                          title="Deactivate Dock"
                        >
                          Disable
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Operating Hours Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2 mb-6">
              <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Operating Hours
            </h2>

            {warehouseLoading ? (
              <p className="text-sm text-slate-500 text-center py-6">Loading schedule...</p>
            ) : (
              <div className="space-y-4">
                {hoursForm.map((oh, idx) => (
                  <div key={oh.day} className="flex items-center justify-between text-sm gap-2">
                    <span className="capitalize font-semibold text-slate-300 w-20">{oh.day.substring(0, 3)}</span>
                    <input
                      type="checkbox"
                      checked={oh.isOpen}
                      onChange={(e) => handleHoursChange(idx, 'isOpen', e.target.checked)}
                      className="rounded bg-slate-950 border-slate-800 text-purple-600 focus:ring-purple-500/20"
                    />
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={oh.start}
                        disabled={!oh.isOpen}
                        onChange={(e) => handleHoursChange(idx, 'start', e.target.value)}
                        className="w-16 text-center bg-slate-950 border border-slate-800 rounded-lg p-1 text-xs text-slate-100 disabled:opacity-30 focus:outline-none"
                      />
                      <span className="text-slate-500">-</span>
                      <input
                        type="text"
                        value={oh.end}
                        disabled={!oh.isOpen}
                        onChange={(e) => handleHoursChange(idx, 'end', e.target.value)}
                        className="w-16 text-center bg-slate-950 border border-slate-800 rounded-lg p-1 text-xs text-slate-100 disabled:opacity-30 focus:outline-none"
                      />
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => saveHoursMutation.mutate(hoursForm)}
                  className="w-full mt-4 py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-sm font-bold transition-all cursor-pointer"
                >
                  Save Schedule
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Live Operations Board & Vendor Approval Queue */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Calendar + Live Operations Board */}
          <div className="space-y-6">
            {/* Booking Calendar */}
            <BookingCalendar
              selectedDate={selectedDate}
              onSelectDate={(d) => setSelectedDate(startOfDay(d))}
            />

            {/* Live Operations Board */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-2">
                <div>
                  <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                    <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-ping" />
                    Live Operations Board
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {format(selectedDate, 'EEEE, MMM d yyyy')} &bull; Auto-polls every 10s
                  </p>
                </div>
              </div>

              {bookingsLoading ? (
                <p className="text-sm text-slate-500 text-center py-12">Loading operations board...</p>
              ) : bookings.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-12">No bookings scheduled for {format(selectedDate, 'MMM d, yyyy')}.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm text-slate-300">
                    <thead className="bg-slate-950 text-slate-400 text-xs uppercase font-bold tracking-wider">
                      <tr>
                        <th className="p-3 rounded-l-xl">Time</th>
                        <th className="p-3">Dock</th>
                        <th className="p-3">Carrier / Truck</th>
                        <th className="p-3">Driver</th>
                        <th className="p-3">Status</th>
                        <th className="p-3 rounded-r-xl text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {bookings.map((booking) => (
                        <tr key={booking._id} className="hover:bg-slate-800/35 transition-colors">
                          <td className="p-3 font-medium text-slate-200 whitespace-nowrap">
                            {formatLocalTime(booking.startTime)}<br/>
                            <span className="text-xs text-slate-500">→ {formatLocalTime(booking.endTime)}</span>
                          </td>
                          <td className="p-3 font-semibold text-slate-200">{booking.dockId?.dockName || 'N/A'}</td>
                          <td className="p-3">
                            <p className="font-semibold text-slate-200">{booking.vendorId?.vendorCompany || 'N/A'}</p>
                            <p className="text-xs text-slate-500">Truck: #{booking.truckNumber}</p>
                          </td>
                          <td className="p-3">
                            <p className="font-semibold text-slate-200">{booking.driverName}</p>
                            <p className="text-xs text-slate-500">{booking.driverPhone}</p>
                          </td>
                          <td className="p-3">
                            <BookingStatusBadge status={booking.status} />
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex justify-end gap-1.5">
                              {booking.status === 'PENDING' && (
                                <>
                                  <button
                                    onClick={() => updateBookingStatusMutation.mutate({ id: booking._id, status: 'APPROVED' })}
                                    className="py-1 px-2.5 rounded bg-green-700 hover:bg-green-600 text-xs font-bold text-white transition-all cursor-pointer"
                                  >
                                    Approve
                                  </button>
                                  <button
                                    onClick={() => updateBookingStatusMutation.mutate({ id: booking._id, status: 'REJECTED' })}
                                    className="py-1 px-2.5 rounded bg-red-950 border border-red-800 hover:bg-red-900 text-xs font-semibold text-red-400 transition-all cursor-pointer"
                                  >
                                    Reject
                                  </button>
                                </>
                              )}

                              {booking.status === 'APPROVED' && (
                                <button
                                  onClick={() => updateBookingStatusMutation.mutate({ id: booking._id, status: 'IN_PROGRESS' })}
                                  className="py-1 px-2.5 rounded bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white transition-all cursor-pointer"
                                >
                                  Mark Arrived
                                </button>
                              )}

                              {booking.status === 'IN_PROGRESS' && (
                                <button
                                  onClick={() => updateBookingStatusMutation.mutate({ id: booking._id, status: 'COMPLETED' })}
                                  className="py-1 px-2.5 rounded bg-teal-600 hover:bg-teal-500 text-xs font-bold text-white transition-all cursor-pointer"
                                >
                                  Mark Departed
                                </button>
                              )}

                              {['PENDING', 'APPROVED', 'IN_PROGRESS'].includes(booking.status) && (
                                <button
                                  onClick={() => updateBookingStatusMutation.mutate({ id: booking._id, status: 'CANCELLED' })}
                                  className="py-1 px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-400 hover:text-slate-200 transition-all cursor-pointer"
                                  title="Cancel booking"
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Vendor Approval Queue Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2 mb-6">
              <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              Vendor Access Registration Queue
            </h2>

            {vendorsLoading ? (
              <p className="text-sm text-slate-500 text-center py-6">Loading vendors...</p>
            ) : pendingVendors.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">No registrations pending approval.</p>
            ) : (
              <div className="divide-y divide-slate-800">
                {pendingVendors.map((vendor) => (
                  <div key={vendor._id} className="py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 first:pt-0 last:pb-0">
                    <div>
                      <p className="text-sm font-semibold text-slate-200">
                        {vendor.username} <span className="text-xs font-normal text-slate-400">({vendor.email})</span>
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">Company: <span className="text-slate-200">{vendor.vendorCompany}</span></p>
                    </div>
                    <div className="flex gap-2 self-start sm:self-auto">
                      <button
                        onClick={() => approveVendorMutation.mutate({ id: vendor._id, status: 'APPROVED' })}
                        className="py-1.5 px-3 rounded-lg bg-green-600 hover:bg-green-500 text-xs font-bold transition-all cursor-pointer"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => approveVendorMutation.mutate({ id: vendor._id, status: 'REJECTED' })}
                        className="py-1.5 px-3 rounded-lg bg-red-950 border border-red-800 hover:bg-red-900 text-red-400 text-xs font-semibold transition-all cursor-pointer"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </main>

      {/* Add/Edit Dock Modal */}
      {isDockModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl relative">
            <h3 className="text-lg font-bold text-slate-100 mb-4">
              {dockForm.id ? 'Edit Dock Configuration' : 'Add New Dock'}
            </h3>
            <form onSubmit={handleSaveDockSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300">Dock Name</label>
                <input
                  type="text"
                  required
                  value={dockForm.name}
                  onChange={(e) => setDockForm({ ...dockForm, name: e.target.value })}
                  className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-purple-500"
                  placeholder="Dock 1, Dock A, North Gate"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300">Max Capacity Per Hour</label>
                <input
                  type="number"
                  min="1"
                  required
                  value={dockForm.capacity}
                  onChange={(e) => setDockForm({ ...dockForm, capacity: parseInt(e.target.value) || 1 })}
                  className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-purple-500"
                />
              </div>
              <div className="flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  checked={dockForm.isActive}
                  onChange={(e) => setDockForm({ ...dockForm, isActive: e.target.checked })}
                  className="rounded bg-slate-950 border-slate-800 text-purple-600 focus:ring-purple-500/20"
                />
                <span className="text-sm text-slate-300">Dock is active and accepting bookings</span>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsDockModalOpen(false)}
                  className="py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="py-2 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-bold"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
