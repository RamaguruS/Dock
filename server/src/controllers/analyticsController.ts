/**
 * Warehouse operations KPIs for a date range (warehouse-local dates, inclusive):
 *   - appointment volume and status mix
 *   - dock utilization (booked places ÷ offered capacity)
 *   - on-time arrival rate, no-show rate, cancellation rate
 *   - gate-to-gate turnaround, yard wait, dock (load/unload) time
 *   - heatmap of appointments by weekday × hour, busiest hours
 *   - per-dock and per-carrier scorecards
 */
import { Request, Response } from 'express';
import { Booking, INACTIVE_STATUSES } from '../models/Booking.js';
import { Dock } from '../models/Dock.js';
import { Warehouse } from '../models/Warehouse.js';
import {
  addDaysToDateString,
  generateSlotGrid,
  localDateString,
  localTimeToUTC,
  localWeekdayHour,
} from '../services/scheduling.js';
import { computeCarrierScores } from '../services/reliability.js';

const isDateString = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const avg = (values: number[]) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);
const pct = (num: number, den: number) => (den === 0 ? null : Math.round((num / den) * 1000) / 10);
const minutesBetween = (a?: Date, b?: Date) => (a && b ? (b.getTime() - a.getTime()) / 60000 : null);

export const getAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    const warehouseId =
      req.user?.role === 'WAREHOUSE_ADMIN' ? req.user.warehouseId : (req.query.warehouseId as string | undefined);
    if (!warehouseId) {
      res.status(400).json({ error: 'No warehouse selected' });
      return;
    }
    const warehouse = await Warehouse.findById(warehouseId);
    if (!warehouse) {
      res.status(404).json({ error: 'Warehouse not found' });
      return;
    }

    const today = localDateString(new Date(), warehouse.timezone);
    const to = isDateString(req.query.to) ? req.query.to : today;
    const from = isDateString(req.query.from) ? req.query.from : addDaysToDateString(to, -29);
    if (from > to) {
      res.status(400).json({ error: '"from" must be on or before "to"' });
      return;
    }

    const rangeStart = localTimeToUTC(from, '00:00', warehouse.timezone);
    const rangeEnd = localTimeToUTC(addDaysToDateString(to, 1), '00:00', warehouse.timezone);

    const [bookings, docks] = await Promise.all([
      Booking.find({ warehouseId, startTime: { $gte: rangeStart, $lt: rangeEnd } }).populate(
        'vendorId',
        'username vendorCompany'
      ),
      Dock.find({ warehouseId }).sort({ dockName: 1 }),
    ]);

    // ---- Capacity offered in the range (slots × dock capacity, minus maintenance) ----
    const activeDocks = docks.filter((d) => d.isActive);
    const capacityByDock = new Map<string, number>(activeDocks.map((d) => [d._id.toString(), 0]));
    let days = 0;
    for (let date = from; date <= to; date = addDaysToDateString(date, 1)) {
      days++;
      const grid = generateSlotGrid(warehouse, date);
      for (const dock of activeDocks) {
        const usable = grid.slots.filter(
          (s) => !(dock.maintenanceWindows ?? []).some((w) => w.startTime < s.endUTC && w.endTime > s.startUTC)
        ).length;
        capacityByDock.set(dock._id.toString(), (capacityByDock.get(dock._id.toString()) ?? 0) + usable * dock.maxCapacityPerHour);
      }
      if (days > 370) break; // guard against huge ranges
    }

    const occupying = bookings.filter((b) => !INACTIVE_STATUSES.includes(b.status) || b.status === 'NO_SHOW');
    const totalCapacity = [...capacityByDock.values()].reduce((a, b) => a + b, 0);

    // ---- Status mix ----
    const byStatus: Record<string, number> = {};
    bookings.forEach((b) => { byStatus[b.status] = (byStatus[b.status] ?? 0) + 1; });

    const onTime = bookings.filter((b) => b.arrivalStatus === 'ON_TIME').length;
    const late = bookings.filter((b) => b.arrivalStatus === 'LATE').length;
    const noShows = byStatus.NO_SHOW ?? 0;
    const cancelled = byStatus.CANCELLED ?? 0;

    const turnaround = bookings.map((b) => minutesBetween(b.checkedInAt, b.completedAt)).filter((v): v is number => v !== null);
    const yardWait = bookings.map((b) => minutesBetween(b.checkedInAt, b.dockStartedAt)).filter((v): v is number => v !== null);
    const dockTime = bookings.map((b) => minutesBetween(b.dockStartedAt, b.completedAt)).filter((v): v is number => v !== null);

    // ---- Heatmap (weekday × hour, warehouse local time) ----
    const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
    const hourTotals = Array(24).fill(0) as number[];
    for (const b of occupying) {
      const { weekday, hour } = localWeekdayHour(b.startTime, warehouse.timezone);
      if (weekday >= 0) heatmap[weekday][hour]++;
      hourTotals[hour]++;
    }
    const busiestHours = hourTotals
      .map((count, hour) => ({ hour, label: `${String(hour).padStart(2, '0')}:00`, count }))
      .filter((h) => h.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // ---- Daily trend ----
    const daily = new Map<string, { date: string; total: number; completed: number; noShow: number; cancelled: number }>();
    for (let date = from; date <= to; date = addDaysToDateString(date, 1)) {
      daily.set(date, { date, total: 0, completed: 0, noShow: 0, cancelled: 0 });
      if (daily.size > 370) break;
    }
    for (const b of bookings) {
      const row = daily.get(localDateString(b.startTime, warehouse.timezone));
      if (!row) continue;
      row.total++;
      if (b.status === 'COMPLETED') row.completed++;
      if (b.status === 'NO_SHOW') row.noShow++;
      if (b.status === 'CANCELLED') row.cancelled++;
    }

    // ---- Per dock ----
    const perDock = docks.map((dock) => {
      const mine = occupying.filter((b) => b.dockId.toString() === dock._id.toString());
      const capacity = capacityByDock.get(dock._id.toString()) ?? 0;
      const dockMinutes = mine
        .map((b) => minutesBetween(b.dockStartedAt, b.completedAt))
        .filter((v): v is number => v !== null);
      return {
        dockId: dock._id,
        dockName: dock.dockName,
        direction: dock.direction,
        isActive: dock.isActive,
        appointments: mine.length,
        capacity,
        utilization: pct(mine.length, capacity),
        avgDockMinutes: avg(dockMinutes),
      };
    });

    // ---- Per carrier ----
    const vendorIds = [...new Set(bookings.map((b) => (b.vendorId as any)?._id?.toString()).filter(Boolean))] as string[];
    const scoresInRange = await computeCarrierScores(vendorIds, { warehouseId, from: rangeStart, to: rangeEnd });
    const overallScores = await computeCarrierScores(vendorIds);
    const carriers = vendorIds
      .map((id) => {
        const vendor = bookings.find((b) => (b.vendorId as any)?._id?.toString() === id)?.vendorId as any;
        const s = scoresInRange.get(id)!;
        const overall = overallScores.get(id)!;
        const mine = bookings.filter((b) => (b.vendorId as any)?._id?.toString() === id);
        return {
          vendorId: id,
          name: vendor?.vendorCompany || vendor?.username,
          appointments: s.totalAppointments,
          completed: s.completed,
          onTime: s.onTime,
          late: s.late,
          noShows: s.noShows,
          cancelled: s.cancelled,
          onTimeRate: s.onTimeRate,
          avgLateMinutes: s.avgLateMinutes,
          pallets: mine.reduce((sum, b) => sum + (b.palletCount ?? 0), 0),
          reliabilityScore: overall.reliabilityScore,
          tier: overall.tier,
          tierLabel: overall.tierLabel,
        };
      })
      .sort((a, b) => b.appointments - a.appointments);

    const countBy = (key: 'direction' | 'trailerType') => {
      const out: Record<string, number> = {};
      occupying.forEach((b) => { out[b[key]] = (out[b[key]] ?? 0) + 1; });
      return out;
    };

    res.status(200).json({
      range: { from, to, days, timezone: warehouse.timezone },
      kpis: {
        totalAppointments: bookings.length,
        completed: byStatus.COMPLETED ?? 0,
        dockUtilization: pct(occupying.length, totalCapacity),
        offeredCapacity: totalCapacity,
        onTimeRate: pct(onTime, onTime + late),
        noShowRate: pct(noShows, onTime + late + noShows),
        cancellationRate: pct(cancelled, bookings.length),
        avgTurnaroundMinutes: avg(turnaround),
        avgYardWaitMinutes: avg(yardWait),
        avgDockMinutes: avg(dockTime),
        palletsHandled: bookings
          .filter((b) => b.status === 'COMPLETED')
          .reduce((sum, b) => sum + (b.palletCount ?? 0), 0),
        avgDailyAppointments: days ? Math.round((bookings.length / days) * 10) / 10 : 0,
      },
      byStatus,
      byDirection: countBy('direction'),
      byTrailerType: countBy('trailerType'),
      heatmap,
      busiestHours,
      daily: [...daily.values()],
      perDock,
      carriers,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
