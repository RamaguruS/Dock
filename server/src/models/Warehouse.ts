import { Schema, model, Document, Types } from 'mongoose';

export interface IOperatingHour {
  day: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
  start: string; // HH:MM format
  end: string;   // HH:MM format
  isOpen: boolean;
}

export interface IBlackoutDate {
  date: string; // YYYY-MM-DD in the warehouse's local timezone
  reason: string;
}

export const SLOT_DURATIONS = [15, 30, 60, 90] as const;

export interface IWarehouse extends Document {
  name: string;
  address: string;
  adminId: Types.ObjectId;
  operatingHours: IOperatingHour[];
  timezone: string;
  /** Length of one appointment slot in minutes (15 / 30 / 60 / 90). */
  slotDurationMinutes: number;
  /** Turnover gap between consecutive slots (trailer swap, dock cleaning). */
  bufferMinutes: number;
  /** A truck checking in later than this after its slot start counts as LATE. */
  lateThresholdMinutes: number;
  /** An APPROVED appointment not checked in this long after its start becomes NO_SHOW. */
  noShowGraceMinutes: number;
  /** Holidays / closures: no slots are offered on these local dates. */
  blackoutDates: IBlackoutDate[];
  createdAt: Date;
  updatedAt: Date;
}

const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;

const operatingHourSchema = new Schema<IOperatingHour>({
  day: {
    type: String,
    enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
    required: true,
  },
  start: {
    type: String,
    required: true,
    validate: {
      validator: (v: string) => timeRegex.test(v),
      message: (props) => `${props.value} is not a valid time format (HH:MM)!`,
    },
    default: '08:00',
  },
  end: {
    type: String,
    required: true,
    validate: {
      validator: (v: string) => timeRegex.test(v),
      message: (props) => `${props.value} is not a valid time format (HH:MM)!`,
    },
    default: '17:00',
  },
  isOpen: {
    type: Boolean,
    required: true,
    default: true,
  },
}, { _id: false });

const blackoutDateSchema = new Schema<IBlackoutDate>(
  {
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    reason: { type: String, required: true, trim: true, maxlength: 120 },
  },
  { _id: false }
);

const warehouseSchema = new Schema<IWarehouse>(
  {
    name: {
      type: String,
      required: [true, 'Warehouse name is required'],
      trim: true,
    },
    address: {
      type: String,
      required: [true, 'Address is required'],
      trim: true,
    },
    adminId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Admin ID is required'],
    },
    operatingHours: {
      type: [operatingHourSchema],
      validate: {
        validator: (v: IOperatingHour[]) => v.length === 7,
        message: 'Operating hours must cover all 7 days of the week',
      },
      default: [
        { day: 'monday', start: '08:00', end: '17:00', isOpen: true },
        { day: 'tuesday', start: '08:00', end: '17:00', isOpen: true },
        { day: 'wednesday', start: '08:00', end: '17:00', isOpen: true },
        { day: 'thursday', start: '08:00', end: '17:00', isOpen: true },
        { day: 'friday', start: '08:00', end: '17:00', isOpen: true },
        { day: 'saturday', start: '08:00', end: '17:00', isOpen: false },
        { day: 'sunday', start: '08:00', end: '17:00', isOpen: false },
      ],
    },
    timezone: {
      type: String,
      required: [true, 'Timezone is required'],
      default: 'UTC',
    },
    slotDurationMinutes: {
      type: Number,
      enum: { values: [...SLOT_DURATIONS], message: 'Slot length must be 15, 30, 60 or 90 minutes' },
      default: 60,
    },
    bufferMinutes: {
      type: Number,
      min: [0, 'Buffer cannot be negative'],
      max: [120, 'Buffer cannot exceed 120 minutes'],
      default: 0,
    },
    lateThresholdMinutes: {
      type: Number,
      min: 0,
      max: 240,
      default: 15,
    },
    noShowGraceMinutes: {
      type: Number,
      min: 5,
      max: 480,
      default: 60,
    },
    blackoutDates: {
      type: [blackoutDateSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

export const Warehouse = model<IWarehouse>('Warehouse', warehouseSchema);
