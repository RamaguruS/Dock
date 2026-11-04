import { type DockDirection, type TrailerType } from '../../lib/format';

export interface OperatingHour {
  day: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
  start: string;
  end: string;
  isOpen: boolean;
}

export interface Warehouse {
  _id: string;
  name: string;
  address: string;
  timezone: string;
  operatingHours: OperatingHour[];
  slotDurationMinutes: number;
  bufferMinutes: number;
  lateThresholdMinutes: number;
  noShowGraceMinutes: number;
  blackoutDates: { date: string; reason: string }[];
}

export interface MaintenanceWindow {
  _id: string;
  startTime: string;
  endTime: string;
  reason: string;
}

export interface Dock {
  _id: string;
  dockName: string;
  maxCapacityPerHour: number;
  isActive: boolean;
  direction: DockDirection;
  supportedTrailerTypes: TrailerType[];
  hazmatCertified: boolean;
  maintenanceWindows: MaintenanceWindow[];
}

export type Notify = (kind: 'success' | 'error', text: string) => void;
