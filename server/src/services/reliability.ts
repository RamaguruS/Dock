/**
 * Carrier reliability scorecard.
 *
 *   Reliability = (on-time arrivals + 0.5 × late arrivals) ÷ (arrivals + no-shows) × 100
 *
 * Arrivals are appointments that were checked in (arrivalStatus set). Cancellations made less
 * than 24 h before the slot are reported separately ("late cancellations") but do not change the score.
 */
import { Types } from 'mongoose';
import { Booking } from '../models/Booking.js';

export interface CarrierScore {
  vendorId: string;
  totalAppointments: number;
  completed: number;
  onTime: number;
  late: number;
  noShows: number;
  cancelled: number;
  lateCancellations: number;
  avgLateMinutes: number | null;
  onTimeRate: number | null; // % of arrivals that were on time
  noShowRate: number | null; // % of due appointments that were no-shows
  reliabilityScore: number | null; // 0–100, null = no history yet
  tier: 'A' | 'B' | 'C' | 'D' | 'NEW';
  tierLabel: string;
}

export const tierFor = (score: number | null): Pick<CarrierScore, 'tier' | 'tierLabel'> => {
  if (score === null) return { tier: 'NEW', tierLabel: 'New carrier' };
  if (score >= 90) return { tier: 'A', tierLabel: 'Excellent' };
  if (score >= 75) return { tier: 'B', tierLabel: 'Good' };
  if (score >= 50) return { tier: 'C', tierLabel: 'Needs improvement' };
  return { tier: 'D', tierLabel: 'Poor' };
};

const pct = (num: number, den: number) => (den === 0 ? null : Math.round((num / den) * 1000) / 10);

/** Scores for the given carriers (all history, optionally limited to one warehouse / date range). */
export async function computeCarrierScores(
  vendorIds: (string | Types.ObjectId)[],
  scope: { warehouseId?: string; from?: Date; to?: Date } = {}
): Promise<Map<string, CarrierScore>> {
  const match: Record<string, unknown> = {
    vendorId: { $in: vendorIds.map((id) => new Types.ObjectId(id.toString())) },
  };
  if (scope.warehouseId) match.warehouseId = new Types.ObjectId(scope.warehouseId);
  if (scope.from || scope.to) {
    match.startTime = {
      ...(scope.from ? { $gte: scope.from } : {}),
      ...(scope.to ? { $lt: scope.to } : {}),
    };
  }

  const rows = await Booking.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$vendorId',
        total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } },
        onTime: { $sum: { $cond: [{ $eq: ['$arrivalStatus', 'ON_TIME'] }, 1, 0] } },
        late: { $sum: { $cond: [{ $eq: ['$arrivalStatus', 'LATE'] }, 1, 0] } },
        lateMinutesSum: { $sum: { $cond: [{ $eq: ['$arrivalStatus', 'LATE'] }, '$lateByMinutes', 0] } },
        noShows: { $sum: { $cond: [{ $eq: ['$status', 'NO_SHOW'] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] } },
        lateCancellations: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$status', 'CANCELLED'] },
                  { $lt: [{ $subtract: ['$startTime', '$updatedAt'] }, 24 * 60 * 60 * 1000] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  const result = new Map<string, CarrierScore>();
  for (const id of vendorIds) {
    const r = rows.find((row) => row._id.toString() === id.toString());
    const onTime = r?.onTime ?? 0;
    const late = r?.late ?? 0;
    const noShows = r?.noShows ?? 0;
    const due = onTime + late + noShows;
    const score = due === 0 ? null : Math.round(((onTime + 0.5 * late) / due) * 100);
    result.set(id.toString(), {
      vendorId: id.toString(),
      totalAppointments: r?.total ?? 0,
      completed: r?.completed ?? 0,
      onTime,
      late,
      noShows,
      cancelled: r?.cancelled ?? 0,
      lateCancellations: r?.lateCancellations ?? 0,
      avgLateMinutes: late ? Math.round((r.lateMinutesSum ?? 0) / late) : null,
      onTimeRate: pct(onTime, onTime + late),
      noShowRate: pct(noShows, due),
      reliabilityScore: score,
      ...tierFor(score),
    });
  }
  return result;
}
