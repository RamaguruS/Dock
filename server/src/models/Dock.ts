import { Schema, model, Document, Types } from 'mongoose';

export const DOCK_DIRECTIONS = ['INBOUND', 'OUTBOUND', 'BOTH'] as const;
export const TRAILER_TYPES = ['DRY_VAN', 'REEFER', 'FLATBED', 'CONTAINER'] as const;

export type DockDirection = (typeof DOCK_DIRECTIONS)[number];
export type TrailerType = (typeof TRAILER_TYPES)[number];

export interface IMaintenanceWindow {
  _id?: Types.ObjectId;
  startTime: Date; // UTC
  endTime: Date;   // UTC
  reason: string;
}

export interface IDock extends Document {
  warehouseId: Types.ObjectId;
  dockName: string;
  /** Number of trucks this door can serve in the same slot. */
  maxCapacityPerHour: number;
  isActive: boolean;
  /** Receiving (inbound), shipping (outbound) or both. */
  direction: DockDirection;
  /** Trailer / equipment types the door can handle (e.g. reefer needs cold-chain plugs). */
  supportedTrailerTypes: TrailerType[];
  /** Certified for hazardous materials. */
  hazmatCertified: boolean;
  /** Planned downtime: slots overlapping these windows are not bookable. */
  maintenanceWindows: Types.DocumentArray<IMaintenanceWindow & Types.Subdocument>;
  /** Bumped inside every booking transaction so concurrent bookings on the same dock conflict and retry. */
  bookingLockVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const maintenanceWindowSchema = new Schema<IMaintenanceWindow>({
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  reason: { type: String, required: true, trim: true, maxlength: 120 },
});

const dockSchema = new Schema<IDock>(
  {
    warehouseId: {
      type: Schema.Types.ObjectId,
      ref: 'Warehouse',
      required: [true, 'Warehouse ID is required'],
      index: true,
    },
    dockName: {
      type: String,
      required: [true, 'Dock name is required'],
      trim: true,
    },
    maxCapacityPerHour: {
      type: Number,
      required: [true, 'Max capacity per hour is required'],
      min: [1, 'Capacity must be at least 1'],
      default: 1,
    },
    isActive: {
      type: Boolean,
      required: true,
      default: true,
    },
    direction: {
      type: String,
      enum: DOCK_DIRECTIONS,
      default: 'BOTH',
    },
    supportedTrailerTypes: {
      type: [{ type: String, enum: TRAILER_TYPES }],
      default: ['DRY_VAN', 'CONTAINER'],
    },
    hazmatCertified: {
      type: Boolean,
      default: false,
    },
    maintenanceWindows: {
      type: [maintenanceWindowSchema],
      default: [],
    },
    bookingLockVersion: {
      type: Number,
      default: 0,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

// Ensure dockName is unique within the same warehouse
dockSchema.index({ warehouseId: 1, dockName: 1 }, { unique: true });

export const Dock = model<IDock>('Dock', dockSchema);

export interface LoadRequirements {
  direction?: string;
  trailerType?: string;
  hazmat?: boolean;
}

/** Can this dock serve a load with these requirements? */
export const isDockCompatible = (
  dock: Pick<IDock, 'direction' | 'supportedTrailerTypes' | 'hazmatCertified'>,
  load: LoadRequirements
): boolean => {
  if (load.direction && dock.direction !== 'BOTH' && dock.direction !== load.direction) return false;
  if (load.trailerType && !(dock.supportedTrailerTypes ?? []).includes(load.trailerType as TrailerType)) return false;
  if (load.hazmat && !dock.hazmatCertified) return false;
  return true;
};
