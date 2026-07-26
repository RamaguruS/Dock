import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { addDays, startOfDay, differenceInDays } from 'date-fns';
import { DateStrip } from '../../components/booking/DateStrip';

// Short timezone abbreviation in the browser's locale (e.g. "IST", "EST", "PDT")
const BrowserTZ = Intl.DateTimeFormat('en', { timeZoneName: 'short' })
  .formatToParts(new Date())
  .find((p) => p.type === 'timeZoneName')?.value ?? '';

const TODAY = startOfDay(new Date());
const MAX_FORWARD_DAYS = 30;

interface Warehouse {
  _id: string;
  name: string;
  address: string;
  timezone: string;
}

interface SlotDetail {
  startTime: string;
  endTime: string;
  localTime: string;
  available: boolean;
  remainingCapacity: number;
  maxCapacity: number;
}

interface DockAvailability {
  dockId: string;
  dockName: string;
  maxCapacityPerHour: number;
  slots: SlotDetail[];
}

interface AvailabilityResponse {
  docks: DockAvailability[];
  closed: boolean;
  message?: string;
}

export const BookingWizard: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(1);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // --- Step 1 state ---
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');

  // --- Step 2 state ---
  // Which 7-day window is shown (expressed as the first day of the window)
  const [stripStart, setStripStart] = useState<Date>(TODAY);
  // Which calendar date is selected in the strip
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // Which slot the user picked
  const [selectedSlot, setSelectedSlot] = useState<{
    dockId: string;
    dockName: string;
    startTime: string;
    endTime: string;
    localTime: string;
  } | null>(null);

  // --- Step 3 state ---
  const [carrierDetails, setCarrierDetails] = useState({
    truckNumber: '',
    driverName: '',
    driverPhone: '',
  });

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  // Fetch list of warehouses for step 1
  const { data: warehouses = [], isLoading: warehousesLoading } = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const res = await api.get('/api/warehouses');
      return res.data.warehouses;
    },
  });

  const selectedWarehouse = warehouses.find((w) => w._id === selectedWarehouseId);

  // Fetch DETAILED slot grid for selected date (stable cache key per [warehouseId, date])
  const {
    data: availabilityData,
    isLoading: availabilityLoading,
    refetch: refetchAvailability,
  } = useQuery<AvailabilityResponse>({
    queryKey: ['availability', selectedWarehouseId, selectedDate],
    queryFn: async () => {
      const res = await api.get(
        `/api/bookings/availability?warehouseId=${selectedWarehouseId}&date=${selectedDate}`
      );
      return res.data;
    },
    enabled: step === 2 && !!selectedWarehouseId && !!selectedDate,
  });

  // -----------------------------------------------------------------------
  // Mutations
  // -----------------------------------------------------------------------
  const createBookingMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSlot) throw new Error('No timeslot selected');
      return api.post('/api/bookings', {
        warehouseId: selectedWarehouseId,
        dockId: selectedSlot.dockId,
        truckNumber: carrierDetails.truckNumber,
        driverName: carrierDetails.driverName,
        driverPhone: carrierDetails.driverPhone,
        startTime: selectedSlot.startTime,
        endTime: selectedSlot.endTime,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendorBookings'] });
      navigate('/vendor');
    },
    onError: (err: any) => {
      if (err.response?.status === 409) {
        setErrorMsg('This slot was just taken! Please select another slot.');
        refetchAvailability();
        setStep(2);
        setSelectedSlot(null);
      } else {
        setErrorMsg(err.response?.data?.error || 'Booking submission failed. Please try again.');
      }
    },
  });

  // -----------------------------------------------------------------------
  // Navigation helpers
  // -----------------------------------------------------------------------
  const stripDaysOffset = differenceInDays(stripStart, TODAY);
  const canGoPrev = stripDaysOffset > 0;
  const canGoNext = stripDaysOffset + 7 < MAX_FORWARD_DAYS;

  const handlePrevWeek = () => {
    const next = addDays(stripStart, -7);
    setStripStart(next < TODAY ? TODAY : next);
  };

  const handleNextWeek = () => {
    const next = addDays(stripStart, 7);
    const maxStart = addDays(TODAY, MAX_FORWARD_DAYS - 7);
    setStripStart(next > maxStart ? maxStart : next);
  };

  const handleDateSelect = (date: string) => {
    if (date !== selectedDate) {
      setSelectedDate(date);
      setSelectedSlot(null);
      setErrorMsg(null);
    }
  };

  const handleSlotSelect = (dock: DockAvailability, slot: SlotDetail) => {
    setSelectedSlot({
      dockId: dock.dockId,
      dockName: dock.dockName,
      startTime: slot.startTime,
      endTime: slot.endTime,
      localTime: slot.localTime,
    });
    setErrorMsg(null);
  };

  const handleStep1Next = () => {
    if (!selectedWarehouseId) { setErrorMsg('Please select a warehouse location.'); return; }
    setErrorMsg(null);
    setStep(2);
  };

  const handleStep2Next = () => {
    if (!selectedDate) { setErrorMsg('Please select a date from the calendar strip.'); return; }
    if (!selectedSlot) { setErrorMsg('Please select an available timeslot.'); return; }
    setErrorMsg(null);
    setStep(3);
  };

  const handleStep3Next = () => {
    if (!carrierDetails.truckNumber.trim()) { setErrorMsg('Truck number / license plate is required.'); return; }
    if (!carrierDetails.driverName.trim())  { setErrorMsg('Driver name is required.'); return; }
    if (!carrierDetails.driverPhone.trim()) { setErrorMsg('Driver phone is required.'); return; }
    setErrorMsg(null);
    setStep(4);
  };

  const handleBack = () => { setErrorMsg(null); setStep((p) => Math.max(1, p - 1)); };

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------
  const renderSlotGrid = () => {
    if (!selectedDate) {
      return (
        <div className="text-center py-10 bg-slate-950/50 border border-slate-800 rounded-2xl">
          <p className="text-sm text-slate-500">← Select a date above to view available slots</p>
        </div>
      );
    }

    if (availabilityLoading) {
      return (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <div key={i} className="bg-slate-950/50 border border-slate-800 rounded-2xl p-4 animate-pulse">
              <div className="h-3 w-24 bg-slate-700 rounded mb-3" />
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: 6 }).map((_, j) => (
                  <div key={j} className="h-12 bg-slate-800 rounded-xl" />
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (availabilityData?.closed) {
      return (
        <div className="text-center py-10 bg-slate-950/50 border border-slate-800 rounded-2xl">
          <p className="text-sm font-bold text-slate-400">🚫 Warehouse Closed</p>
          <p className="text-xs text-slate-500 mt-1">{availabilityData.message}</p>
        </div>
      );
    }

    if (!availabilityData?.docks?.length) {
      return (
        <div className="text-center py-10 bg-slate-950/50 border border-slate-800 rounded-2xl">
          <p className="text-sm text-slate-500">No active docks found for this warehouse.</p>
        </div>
      );
    }

    return (
      <div className="space-y-5">
        {availabilityData.docks.map((dock) => (
          <div key={dock.dockId}>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-xs font-black text-purple-400 uppercase tracking-wider">{dock.dockName}</h3>
              {dock.maxCapacityPerHour > 1 && (
                <span className="text-[10px] text-slate-500 bg-slate-800 border border-slate-700 rounded-full px-2 py-0.5">
                  {dock.maxCapacityPerHour} trucks/hr
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {dock.slots.map((slot, idx) => {
                const isSelected =
                  selectedSlot?.dockId === dock.dockId &&
                  selectedSlot?.startTime === slot.startTime;

                const multiCapacity = dock.maxCapacityPerHour > 1;

                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={!slot.available}
                    onClick={() => handleSlotSelect(dock, slot)}
                    className={`
                      p-3 rounded-xl text-center text-xs font-semibold border
                      transition-all duration-150 cursor-pointer flex flex-col items-center gap-1
                      ${!slot.available
                        ? 'bg-red-950/40 border-red-900/30 text-red-500/50 cursor-not-allowed opacity-60'
                        : isSelected
                        ? 'bg-purple-600 border-purple-500 text-white shadow-lg shadow-purple-900/25 scale-[1.02]'
                        : 'bg-slate-900/80 border-slate-700/50 text-slate-200 hover:border-emerald-600/50 hover:bg-slate-800/70 hover:text-emerald-400'
                      }
                    `}
                  >
                    <span>{slot.localTime}</span>
                    {multiCapacity && (
                      <span className={`text-[9px] font-bold leading-none
                        ${!slot.available ? 'text-red-500/50' : isSelected ? 'text-purple-200' : 'text-emerald-400/80'}`}>
                        {slot.available
                          ? `${slot.remainingCapacity}/${slot.maxCapacity} free`
                          : 'Full'}
                      </span>
                    )}
                    {!multiCapacity && !slot.available && (
                      <span className="text-[9px] font-bold leading-none text-red-500/60">Full</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-4 lg:p-8 flex flex-col justify-center items-center">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 md:p-8 relative overflow-hidden">
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-purple-600/10 rounded-full blur-3xl" />

        {/* Progress bar */}
        <div className="relative z-10 mb-8">
          <div className="flex items-center justify-between text-xs text-slate-400 font-semibold mb-2">
            <span>Step {step} of 4</span>
            <span>
              {step === 1 && 'Warehouse'}
              {step === 2 && 'Date & Timeslot'}
              {step === 3 && 'Carrier & Driver Details'}
              {step === 4 && 'Summary & Confirmation'}
            </span>
          </div>
          <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden">
            <div className="bg-purple-600 h-full transition-all duration-300" style={{ width: `${(step / 4) * 100}%` }} />
          </div>
        </div>

        {/* Error alert */}
        {errorMsg && (
          <div className="p-4 bg-red-950/50 border border-red-500/30 rounded-xl text-red-400 text-sm mb-6 flex justify-between items-center animate-fade-in relative z-10">
            <span>{errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-red-200 font-bold ml-3">&times;</button>
          </div>
        )}

        {/* Steps */}
        <div className="relative z-10 min-h-[250px]">

          {/* ── STEP 1: Warehouse Selection ──────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-6 animate-fade-in">
              <h2 className="text-xl font-bold text-slate-100">Choose Warehouse Location</h2>
              <div>
                <label htmlFor="warehouse" className="block text-sm font-semibold text-slate-300">
                  Select Warehouse
                </label>
                {warehousesLoading ? (
                  <p className="text-sm text-slate-500 mt-2">Loading warehouses...</p>
                ) : (
                  <select
                    id="warehouse"
                    value={selectedWarehouseId}
                    onChange={(e) => {
                      setSelectedWarehouseId(e.target.value);
                      setSelectedDate(null);
                      setSelectedSlot(null);
                    }}
                    className="w-full mt-2 bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-sm text-slate-100 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
                  >
                    <option value="">-- Choose Location --</option>
                    {warehouses.map((w) => (
                      <option key={w._id} value={w._id}>
                        {w.name} ({w.address})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )}

          {/* ── STEP 2: Date Strip + Slot Grid ───────────────────────────── */}
          {step === 2 && (
            <div className="space-y-5 animate-fade-in">
              <div>
                <h2 className="text-xl font-bold text-slate-100">
                  Select Date &amp; Timeslot
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {selectedWarehouse?.name} &bull; Warehouse TZ: {selectedWarehouse?.timezone} &bull; Your TZ: {BrowserTZ}
                </p>
              </div>

              {/* 7-day strip */}
              <DateStrip
                warehouseId={selectedWarehouseId}
                stripStart={stripStart}
                selectedDate={selectedDate}
                onDateSelect={handleDateSelect}
                onPrev={handlePrevWeek}
                onNext={handleNextWeek}
                canGoPrev={canGoPrev}
                canGoNext={canGoNext}
              />

              {/* Selected date label */}
              {selectedDate && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Showing slots for:</span>
                  <span className="text-xs font-bold text-purple-400 bg-purple-950/40 border border-purple-800/30 rounded-full px-2.5 py-0.5">
                    {selectedDate}
                  </span>
                  {selectedSlot && (
                    <span className="text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/30 rounded-full px-2.5 py-0.5 font-semibold">
                      ✓ {selectedSlot.dockName} · {selectedSlot.localTime}
                    </span>
                  )}
                </div>
              )}

              {/* Slot grid */}
              <div className="max-h-72 overflow-y-auto pr-1 space-y-1 custom-scroll">
                {renderSlotGrid()}
              </div>
            </div>
          )}

          {/* ── STEP 3: Carrier & Driver ─────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-5 animate-fade-in">
              <h2 className="text-xl font-bold text-slate-100">Carrier &amp; Dispatch details</h2>

              <div>
                <label htmlFor="truckNumber" className="block text-sm font-semibold text-slate-300">
                  Truck Number / License Plate
                </label>
                <input
                  id="truckNumber"
                  type="text"
                  required
                  value={carrierDetails.truckNumber}
                  onChange={(e) => setCarrierDetails({ ...carrierDetails, truckNumber: e.target.value })}
                  placeholder="e.g. TRK-8899 or IL-9838"
                  className="w-full mt-2 bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-sm text-slate-100 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
                />
              </div>

              <div>
                <label htmlFor="driverName" className="block text-sm font-semibold text-slate-300">
                  Driver Full Name
                </label>
                <input
                  id="driverName"
                  type="text"
                  required
                  value={carrierDetails.driverName}
                  onChange={(e) => setCarrierDetails({ ...carrierDetails, driverName: e.target.value })}
                  placeholder="John Doe"
                  className="w-full mt-2 bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-sm text-slate-100 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
                />
              </div>

              <div>
                <label htmlFor="driverPhone" className="block text-sm font-semibold text-slate-300">
                  Driver Mobile Phone
                </label>
                <input
                  id="driverPhone"
                  type="tel"
                  required
                  value={carrierDetails.driverPhone}
                  onChange={(e) => setCarrierDetails({ ...carrierDetails, driverPhone: e.target.value })}
                  placeholder="+1 (555) 019-2834"
                  className="w-full mt-2 bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-sm text-slate-100 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
                />
              </div>
            </div>
          )}

          {/* ── STEP 4: Review & Confirm ─────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-6 animate-fade-in text-sm">
              <h2 className="text-xl font-bold text-slate-100">Review Booking Request</h2>

              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4 border-b border-slate-900 pb-4">
                  <div>
                    <span className="text-[10px] text-slate-500 font-bold uppercase block">Warehouse</span>
                    <span className="font-bold text-slate-200">{selectedWarehouse?.name}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-bold uppercase block">Address</span>
                    <span className="text-slate-300">{selectedWarehouse?.address}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 border-b border-slate-900 pb-4">
                  <div>
                    <span className="text-[10px] text-slate-500 font-bold uppercase block">Date &amp; Timeslot</span>
                    <span className="font-bold text-purple-400">
                      {selectedDate} — {selectedSlot?.localTime}
                    </span>
                    <span className="text-[10px] text-slate-500 block mt-0.5">
                      wh: {selectedWarehouse?.timezone} / you: {BrowserTZ}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-bold uppercase block">Dock</span>
                    <span className="font-bold text-slate-200">{selectedSlot?.dockName}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-[10px] text-slate-500 font-bold uppercase block">Truck Number</span>
                    <span className="font-semibold text-slate-200">{carrierDetails.truckNumber}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-bold uppercase block">Driver Contact</span>
                    <span className="text-slate-300">{carrierDetails.driverName} ({carrierDetails.driverPhone})</span>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-purple-950/20 border border-purple-500/10 rounded-xl text-purple-300 text-xs">
                ⚠️ Overlap prevention is atomically checked in the database. If this timeslot is reserved by another vendor before you click submit, you will be prompted to pick a new timeslot.
              </div>
            </div>
          )}
        </div>

        {/* Wizard controls */}
        <div className="flex items-center justify-between pt-6 border-t border-slate-800 mt-8 relative z-10">
          <button
            type="button"
            onClick={step === 1 ? () => navigate('/vendor') : handleBack}
            className="py-2.5 px-5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-semibold transition-all cursor-pointer"
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>

          {step < 4 ? (
            <button
              type="button"
              onClick={
                step === 1 ? handleStep1Next :
                step === 2 ? handleStep2Next :
                handleStep3Next
              }
              className="py-2.5 px-6 rounded-xl bg-purple-600 hover:bg-purple-500 text-sm font-bold text-white transition-all cursor-pointer shadow-lg shadow-purple-900/20"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              disabled={createBookingMutation.isPending}
              onClick={() => createBookingMutation.mutate()}
              className="py-2.5 px-6 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-bold text-white transition-all cursor-pointer shadow-lg shadow-purple-900/20"
            >
              {createBookingMutation.isPending ? 'Submitting Request...' : 'Confirm Request'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
