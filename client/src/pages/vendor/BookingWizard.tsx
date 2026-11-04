import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { useVendorAccess } from '../../hooks/useVendorAccess';
import { SlotPicker, type PickedSlot, type LoadFilter } from '../../components/booking/SlotPicker';
import { Alert, Button, Field, inputClass } from '../../components/ui';
import { TRAILER_LABEL, TRAILER_TYPES, type TrailerType, errorMessage, fmtDate, tzAbbrev } from '../../lib/format';

const STEPS = ['Load details', 'Dock & timeslot', 'Shipment details', 'Confirm'];

export const BookingWizard: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(1);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<{ message: string; skipped: { date: string; reason: string }[] } | null>(null);

  const [warehouseId, setWarehouseId] = useState('');
  const [load, setLoad] = useState<LoadFilter>({ direction: 'INBOUND', trailerType: 'DRY_VAN', hazmat: false });
  const [slot, setSlot] = useState<PickedSlot | null>(null);
  const [waitlistMode, setWaitlistMode] = useState(false);
  const [details, setDetails] = useState({
    truckNumber: '',
    driverName: '',
    driverPhone: '',
    referenceNumber: '',
    palletCount: '',
    cargoDescription: '',
  });
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [weeks, setWeeks] = useState(4);

  const { data: access = [], isLoading: warehousesLoading } = useVendorAccess();
  const warehouses = access.filter((a) => a.status === 'APPROVED').map((a) => a.warehouseId);
  const warehouse = warehouses.find((w) => w._id === warehouseId);

  const payload = () => ({
    warehouseId,
    dockId: slot!.dockId,
    startTime: slot!.startTime,
    endTime: slot!.endTime,
    ...load,
    truckNumber: details.truckNumber,
    driverName: details.driverName,
    driverPhone: details.driverPhone,
    referenceNumber: details.referenceNumber || undefined,
    palletCount: details.palletCount ? Number(details.palletCount) : undefined,
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (waitlistMode) return api.post('/api/waitlist', payload());
      return api.post('/api/bookings', {
        ...payload(),
        cargoDescription: details.cargoDescription || undefined,
        recurrence: repeatWeekly ? { weeks } : undefined,
      });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['vendorBookings'] });
      queryClient.invalidateQueries({ queryKey: ['vendorWaitlist'] });
      queryClient.invalidateQueries({ queryKey: ['availability'] });
      setResult({ message: res.data.message, skipped: res.data.skipped ?? [] });
    },
    onError: (err: any) => {
      if (err.response?.status === 409 && !waitlistMode) {
        setErrorMsg('This slot was just taken by another carrier. Pick another slot or join its waitlist.');
        queryClient.invalidateQueries({ queryKey: ['availability'] });
        setSlot(null);
        setStep(2);
      } else {
        setErrorMsg(errorMessage(err, 'Submission failed. Please try again.'));
      }
    },
  });

  const canNext =
    (step === 1 && !!warehouseId) ||
    (step === 2 && !!slot) ||
    (step === 3 && details.truckNumber.trim() && details.driverName.trim() && details.driverPhone.trim().length >= 5);

  const next = () => {
    setErrorMsg(null);
    if (step === 4) submit.mutate();
    else setStep((s) => s + 1);
  };

  if (result) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-6 flex items-center justify-center">
        <div className="max-w-lg w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-4">
          <div className="text-4xl">{waitlistMode ? '⏳' : '✅'}</div>
          <h1 className="text-xl font-bold">{result.message}</h1>
          <p className="text-sm text-slate-400">
            {waitlistMode
              ? 'If a place opens up on this slot it will be assigned to you automatically and you will be notified.'
              : 'The warehouse will review your request. You will get a notification when it is approved.'}
          </p>
          {result.skipped.length > 0 && (
            <div className="text-left text-xs bg-slate-950 border border-slate-800 rounded-xl p-3">
              <p className="font-bold text-amber-400 mb-1">Weeks not booked:</p>
              {result.skipped.map((s) => (
                <p key={s.date} className="text-slate-400">
                  {s.date}: {s.reason}
                </p>
              ))}
            </div>
          )}
          <Button variant="primary" onClick={() => navigate('/vendor')}>
            Back to dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-6 lg:p-8">
      <div className="max-w-4xl mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-6 md:p-8 shadow-2xl">
        <div className="mb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-purple-400">
            {waitlistMode ? 'Join waitlist' : 'New dock appointment'}
          </span>
          <h1 className="text-2xl font-extrabold mt-1">
            Step {step} of 4 · {STEPS[step - 1]}
          </h1>
          <div className="flex gap-1.5 mt-3">
            {STEPS.map((_, i) => (
              <div key={i} className={`h-1.5 flex-1 rounded-full ${i < step ? 'bg-purple-500' : 'bg-slate-800'}`} />
            ))}
          </div>
        </div>

        {errorMsg && (
          <div className="mb-4">
            <Alert kind="error" onClose={() => setErrorMsg(null)}>
              {errorMsg}
            </Alert>
          </div>
        )}

        <div className="min-h-[260px]">
          {step === 1 && (
            <div className="space-y-5">
              <Field label="Warehouse / distribution centre">
                {warehousesLoading ? (
                  <p className="text-sm text-slate-500">Loading…</p>
                ) : warehouses.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    No warehouse has approved your account yet. Request access from your dashboard.
                  </p>
                ) : (
                  <select
                    className={inputClass}
                    value={warehouseId}
                    onChange={(e) => {
                      setWarehouseId(e.target.value);
                      setSlot(null);
                    }}
                  >
                    <option value="">— Choose a site —</option>
                    {warehouses.map((w) => (
                      <option key={w._id} value={w._id}>
                        {w.name} ({w.address})
                      </option>
                    ))}
                  </select>
                )}
              </Field>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Movement type">
                  <div className="grid grid-cols-2 gap-2">
                    {(['INBOUND', 'OUTBOUND'] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => {
                          setLoad((l) => ({ ...l, direction: d }));
                          setSlot(null);
                        }}
                        className={`py-2.5 rounded-xl border text-sm font-semibold cursor-pointer ${
                          load.direction === d ? 'bg-purple-600 border-purple-500' : 'bg-slate-950 border-slate-800 hover:border-slate-600'
                        }`}
                      >
                        {d === 'INBOUND' ? '⬇ Inbound delivery' : '⬆ Outbound pickup'}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Trailer / equipment type">
                  <select
                    className={inputClass}
                    value={load.trailerType}
                    onChange={(e) => {
                      setLoad((l) => ({ ...l, trailerType: e.target.value as TrailerType }));
                      setSlot(null);
                    }}
                  >
                    {TRAILER_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TRAILER_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <label className="flex items-center gap-3 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-orange-500 w-4 h-4"
                  checked={load.hazmat}
                  onChange={(e) => {
                    setLoad((l) => ({ ...l, hazmat: e.target.checked }));
                    setSlot(null);
                  }}
                />
                <span>
                  Hazardous materials (dangerous goods)
                  <span className="block text-xs text-slate-500">Only hazmat-certified docks will be offered.</span>
                </span>
              </label>
            </div>
          )}

          {step === 2 && warehouse && (
            <SlotPicker
              warehouseId={warehouseId}
              warehouseTimezone={warehouse.timezone}
              load={load}
              selected={slot}
              onSelect={(s) => {
                setSlot(s);
                setWaitlistMode(false);
              }}
              onJoinWaitlist={(s) => {
                setSlot(s);
                setWaitlistMode(true);
                setStep(3);
              }}
            />
          )}

          {step === 3 && (
            <div className="space-y-4">
              {waitlistMode && (
                <Alert kind="info">
                  This slot is full. You are joining the <b>waitlist</b> for {slot?.dockName}, {slot?.localTime}. If a carrier
                  cancels, the slot is assigned to you automatically.{' '}
                  <button className="underline cursor-pointer" onClick={() => { setWaitlistMode(false); setSlot(null); setStep(2); }}>
                    Pick another slot instead
                  </button>
                </Alert>
              )}
              <div className="grid sm:grid-cols-3 gap-4">
                <Field label="Truck / trailer number *">
                  <input className={inputClass} placeholder="TN 09 AB 1234" value={details.truckNumber} onChange={(e) => setDetails({ ...details, truckNumber: e.target.value })} />
                </Field>
                <Field label="Driver name *">
                  <input className={inputClass} placeholder="Ravi Kumar" value={details.driverName} onChange={(e) => setDetails({ ...details, driverName: e.target.value })} />
                </Field>
                <Field label="Driver mobile *" hint="Used for SMS reminders">
                  <input className={inputClass} placeholder="+91 98400 12345" value={details.driverPhone} onChange={(e) => setDetails({ ...details, driverPhone: e.target.value })} />
                </Field>
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
                <Field label="PO / ASN reference">
                  <input className={inputClass} placeholder="PO-4500123" value={details.referenceNumber} onChange={(e) => setDetails({ ...details, referenceNumber: e.target.value })} />
                </Field>
                <Field label="Pallet count">
                  <input type="number" min={0} max={100} className={inputClass} placeholder="24" value={details.palletCount} onChange={(e) => setDetails({ ...details, palletCount: e.target.value })} />
                </Field>
                {!waitlistMode && (
                  <Field label="Cargo description">
                    <input className={inputClass} placeholder="FMCG cartons" value={details.cargoDescription} onChange={(e) => setDetails({ ...details, cargoDescription: e.target.value })} />
                  </Field>
                )}
              </div>
              {!waitlistMode && (
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
                  <label className="flex items-center gap-3 text-sm cursor-pointer">
                    <input type="checkbox" className="accent-purple-500 w-4 h-4" checked={repeatWeekly} onChange={(e) => setRepeatWeekly(e.target.checked)} />
                    <span className="font-semibold">Recurring appointment — repeat every week at this time</span>
                  </label>
                  {repeatWeekly && (
                    <div className="mt-3 flex items-center gap-3 text-sm">
                      <span className="text-slate-400">For</span>
                      <input type="number" min={2} max={12} className={`${inputClass} !w-20`} value={weeks} onChange={(e) => setWeeks(Math.min(12, Math.max(2, Number(e.target.value) || 2)))} />
                      <span className="text-slate-400">weeks (each week is booked only if the slot is free)</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 4 && slot && warehouse && (
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-5 text-sm grid sm:grid-cols-2 gap-y-3 gap-x-6">
              <Summary label="Site" value={warehouse.name} />
              <Summary label="Dock" value={slot.dockName} />
              <Summary label="Date" value={fmtDate(slot.startTime, warehouse.timezone)} />
              <Summary label="Slot" value={`${slot.localTime} (${tzAbbrev(warehouse.timezone)})`} />
              <Summary label="Movement" value={load.direction === 'INBOUND' ? 'Inbound delivery' : 'Outbound pickup'} />
              <Summary label="Equipment" value={`${TRAILER_LABEL[load.trailerType]}${load.hazmat ? ' · Hazmat' : ''}`} />
              <Summary label="Truck" value={details.truckNumber} />
              <Summary label="Driver" value={`${details.driverName} · ${details.driverPhone}`} />
              {details.referenceNumber && <Summary label="PO / ASN" value={details.referenceNumber} />}
              {details.palletCount && <Summary label="Pallets" value={details.palletCount} />}
              <Summary
                label="Request type"
                value={waitlistMode ? 'Waitlist (auto-assign when a place frees up)' : repeatWeekly ? `Weekly series × ${weeks}` : 'Single appointment'}
              />
            </div>
          )}
        </div>

        <div className="flex justify-between mt-8 pt-5 border-t border-slate-800">
          <Button onClick={() => (step === 1 ? navigate('/vendor') : setStep((s) => s - 1))}>{step === 1 ? 'Cancel' : 'Back'}</Button>
          <Button variant="primary" disabled={!canNext && step !== 4} onClick={next}>
            {step === 4 ? (submit.isPending ? 'Submitting…' : waitlistMode ? 'Join waitlist' : 'Request appointment') : 'Continue'}
          </Button>
        </div>
      </div>
    </div>
  );
};

const Summary: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div>
    <p className="text-[11px] uppercase tracking-wider text-slate-500 font-bold">{label}</p>
    <p className="text-slate-100 font-medium">{value}</p>
  </div>
);
