import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { Alert, Button, Modal } from '../ui';
import { SlotPicker, type PickedSlot } from './SlotPicker';
import { type Booking, errorMessage, fmtDateTime } from '../../lib/format';

export const RescheduleModal: React.FC<{
  booking: Booking;
  asVendor: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}> = ({ booking, asVendor, onClose, onDone }) => {
  const queryClient = useQueryClient();
  const [slot, setSlot] = useState<PickedSlot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tz = booking.warehouseId?.timezone;

  const mutation = useMutation({
    mutationFn: () =>
      api.patch(`/api/bookings/${booking._id}/reschedule`, {
        dockId: slot!.dockId,
        startTime: slot!.startTime,
        endTime: slot!.endTime,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      onDone(`Truck ${booking.truckNumber} moved to ${slot!.dockName}, ${fmtDateTime(slot!.startTime, tz)}`);
    },
    onError: (err) => setError(errorMessage(err, 'Could not reschedule')),
  });

  return (
    <Modal title={`Reschedule truck ${booking.truckNumber}`} onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm text-slate-400">
          Currently: <b className="text-slate-200">{booking.dockId?.dockName}</b>, {fmtDateTime(booking.startTime, tz)}.
          {asVendor && booking.status === 'APPROVED' && ' Moving a confirmed appointment sends it back for warehouse approval.'}
          {' '}The old slot is released to the waitlist automatically.
        </p>
        {error && (
          <Alert kind="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        <SlotPicker
          warehouseId={booking.warehouseId?._id ?? ''}
          warehouseTimezone={tz}
          load={{ direction: booking.direction, trailerType: booking.trailerType, hazmat: booking.hazmat }}
          selected={slot}
          onSelect={setSlot}
          currentStart={booking.startTime}
        />
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!slot || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Moving…' : slot ? `Move to ${slot.localTime}` : 'Pick a new slot'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
