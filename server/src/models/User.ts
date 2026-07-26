import { Schema, model, Document, Types } from 'mongoose';

export type UserRole = 'SUPER_ADMIN' | 'WAREHOUSE_ADMIN' | 'VENDOR';
export type VendorStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface IUser extends Document {
  username: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  warehouseId?: Types.ObjectId;
  vendorCompany?: string;
  status: VendorStatus;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      minlength: [3, 'Username must be at least 3 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please use a valid email address'],
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
    },
    role: {
      type: String,
      enum: {
        values: ['SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'VENDOR'],
        message: '{VALUE} is not a valid role',
      },
      required: [true, 'Role is required'],
    },
    warehouseId: {
      type: Schema.Types.ObjectId,
      ref: 'Warehouse',
      required: function (this: IUser) {
        return this.role === 'WAREHOUSE_ADMIN';
      },
    },
    vendorCompany: {
      type: String,
      required: function (this: IUser) {
        return this.role === 'VENDOR';
      },
      trim: true,
    },
    status: {
      type: String,
      enum: {
        values: ['PENDING', 'APPROVED', 'REJECTED'],
        message: '{VALUE} is not a valid vendor status',
      },
      default: function (this: IUser) {
        return this.role === 'VENDOR' ? 'PENDING' : 'APPROVED';
      },
    },
  },
  {
    timestamps: true,
  }
);

// Prevent returning passwordHash in JSON
userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete (ret as any).passwordHash;
    return ret;
  },
});

export const User = model<IUser>('User', userSchema);
