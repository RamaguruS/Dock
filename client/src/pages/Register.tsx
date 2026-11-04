import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

interface WarehouseOption {
  _id: string;
  name: string;
  address: string;
  timezone: string;
}

/** Server validation errors can be a plain string or a zod `format()` object. */
const toErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const messages: string[] = [];
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node._errors)) messages.push(...node._errors);
      Object.entries(node).forEach(([key, value]) => key !== '_errors' && walk(value));
    };
    walk(error);
    if (messages.length) return messages.join(' ');
  }
  return fallback;
};

const registerSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters'),
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(['WAREHOUSE_ADMIN', 'VENDOR']),
  // Vendor specific
  vendorCompany: z.string().optional(),
  warehouseIds: z.array(z.string()).optional(),
  // Admin specific
  warehouseName: z.string().optional(),
  warehouseAddress: z.string().optional(),
  timezone: z.string(),
}).superRefine((data, ctx) => {
  if (data.role === 'VENDOR') {
    if (!data.vendorCompany || data.vendorCompany.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vendorCompany'],
        message: 'Vendor company name is required',
      });
    }
    if (!data.warehouseIds || data.warehouseIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['warehouseIds'],
        message: 'Select at least one warehouse you want to book at',
      });
    }
  } else if (data.role === 'WAREHOUSE_ADMIN') {
    if (!data.warehouseName || data.warehouseName.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['warehouseName'],
        message: 'Warehouse name is required',
      });
    }
    if (!data.warehouseAddress || data.warehouseAddress.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['warehouseAddress'],
        message: 'Warehouse address is required',
      });
    }
  }
});

type RegisterForm = z.infer<typeof registerSchema>;

export const Register: React.FC = () => {
  const { register: registerApi } = useAuth();
  const navigate = useNavigate();
  const [apiError, setApiError] = useState<string | null>(null);
  const [apiSuccess, setApiSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const {
    register: formRegister,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitted },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      role: 'VENDOR',
      username: '',
      email: '',
      password: '',
      vendorCompany: '',
      warehouseIds: [],
      warehouseName: '',
      warehouseAddress: '',
      timezone: 'UTC',
    },
  });

  const selectedRole = watch('role');
  const selectedWarehouseIds = watch('warehouseIds') ?? [];

  const { data: warehouses = [], isLoading: warehousesLoading } = useQuery<WarehouseOption[]>({
    queryKey: ['public-warehouses'],
    queryFn: async () => (await api.get('/api/warehouses')).data.warehouses,
    enabled: selectedRole === 'VENDOR',
  });

  const toggleWarehouse = (id: string) => {
    const next = selectedWarehouseIds.includes(id)
      ? selectedWarehouseIds.filter((w) => w !== id)
      : [...selectedWarehouseIds, id];
    setValue('warehouseIds', next, { shouldValidate: isSubmitted });
  };

  const onSubmit = async (data: RegisterForm) => {
    setIsLoading(true);
    setApiError(null);
    setApiSuccess(null);
    try {
      const result = await registerApi(data);
      setApiSuccess(result.message || 'Registration successful!');
      setTimeout(() => {
        navigate('/login');
      }, 2500);
    } catch (err: any) {
      setApiError(toErrorMessage(err.response?.data?.error, 'Registration failed. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-slate-100 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-purple-600/10 border border-purple-500/20 text-purple-400 mb-4">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-slate-100 to-slate-400 bg-clip-text text-transparent">
          Create your SmartDock Account
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-purple-400 hover:text-purple-300 transition-colors">
            Sign in instead
          </Link>
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-slate-900 border border-slate-800 py-8 px-4 shadow-2xl rounded-2xl sm:px-10 relative overflow-hidden">
          <div className="absolute -top-24 -left-24 w-48 h-48 bg-purple-600/10 rounded-full blur-3xl" />

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 relative z-10">
            {apiError && (
              <div className="rounded-xl bg-red-950/50 border border-red-500/30 p-4 text-sm text-red-400 flex items-start space-x-2">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>{apiError}</span>
              </div>
            )}

            {apiSuccess && (
              <div className="rounded-xl bg-green-950/50 border border-green-500/30 p-4 text-sm text-green-400 flex items-start space-x-2 animate-bounce">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{apiSuccess} Redirecting to login...</span>
              </div>
            )}

            <div>
              <label htmlFor="username" className="block text-sm font-semibold text-slate-300">
                Username
              </label>
              <div className="mt-1">
                <input
                  id="username"
                  type="text"
                  {...formRegister('username')}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
                  placeholder="johndoe"
                />
                {errors.username && (
                  <p className="mt-1 text-xs text-red-400 font-medium">{errors.username.message}</p>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-slate-300">
                Email Address
              </label>
              <div className="mt-1">
                <input
                  id="email"
                  type="email"
                  {...formRegister('email')}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
                  placeholder="name@company.com"
                />
                {errors.email && (
                  <p className="mt-1 text-xs text-red-400 font-medium">{errors.email.message}</p>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-slate-300">
                Password
              </label>
              <div className="mt-1">
                <input
                  id="password"
                  type="password"
                  {...formRegister('password')}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
                  placeholder="••••••••"
                />
                {errors.password && (
                  <p className="mt-1 text-xs text-red-400 font-medium">{errors.password.message}</p>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="role" className="block text-sm font-semibold text-slate-300">
                Account Type
              </label>
              <div className="mt-1">
                <select
                  id="role"
                  {...formRegister('role')}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-sm text-slate-100 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
                >
                  <option value="VENDOR">Vendor (Truck Operator / Carrier)</option>
                  <option value="WAREHOUSE_ADMIN">Warehouse Administrator</option>
                </select>
              </div>
            </div>

            {/* Vendor Specific Fields */}
            {selectedRole === 'VENDOR' && (
              <div className="animate-fade-in">
                <label htmlFor="vendorCompany" className="block text-sm font-semibold text-slate-300">
                  Vendor Company Name
                </label>
                <div className="mt-1">
                  <input
                    id="vendorCompany"
                    type="text"
                    {...formRegister('vendorCompany')}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
                    placeholder="Logistics Corp"
                  />
                  {errors.vendorCompany && (
                    <p className="mt-1 text-xs text-red-400 font-medium">{errors.vendorCompany.message}</p>
                  )}
                </div>

                <fieldset className="mt-4">
                  <legend className="block text-sm font-semibold text-slate-300">
                    Warehouses you want to book at
                  </legend>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Each warehouse approves your access separately. You can request more later.
                  </p>
                  <div className="mt-2 max-h-48 overflow-y-auto space-y-2 rounded-xl border border-slate-800 bg-slate-950 p-3">
                    {warehousesLoading && <p className="text-xs text-slate-500">Loading warehouses...</p>}
                    {!warehousesLoading && warehouses.length === 0 && (
                      <p className="text-xs text-slate-500">No warehouses are registered yet.</p>
                    )}
                    {warehouses.map((w) => (
                      <label key={w._id} className="flex items-start gap-3 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={selectedWarehouseIds.includes(w._id)}
                          onChange={() => toggleWarehouse(w._id)}
                          className="mt-1 accent-purple-500"
                        />
                        <span>
                          <span className="block text-slate-200 font-medium">{w.name}</span>
                          <span className="block text-xs text-slate-500">{w.address}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {errors.warehouseIds && (
                    <p className="mt-1 text-xs text-red-400 font-medium">{errors.warehouseIds.message}</p>
                  )}
                </fieldset>
              </div>
            )}

            {/* Warehouse Admin Specific Fields */}
            {selectedRole === 'WAREHOUSE_ADMIN' && (
              <div className="space-y-4 animate-fade-in">
                <div>
                  <label htmlFor="warehouseName" className="block text-sm font-semibold text-slate-300">
                    Warehouse Name
                  </label>
                  <div className="mt-1">
                    <input
                      id="warehouseName"
                      type="text"
                      {...formRegister('warehouseName')}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
                      placeholder="Chicago East Hub"
                    />
                    {errors.warehouseName && (
                      <p className="mt-1 text-xs text-red-400 font-medium">{errors.warehouseName.message}</p>
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="warehouseAddress" className="block text-sm font-semibold text-slate-300">
                    Warehouse Address
                  </label>
                  <div className="mt-1">
                    <input
                      id="warehouseAddress"
                      type="text"
                      {...formRegister('warehouseAddress')}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
                      placeholder="123 Logistics Blvd, Chicago IL"
                    />
                    {errors.warehouseAddress && (
                      <p className="mt-1 text-xs text-red-400 font-medium">{errors.warehouseAddress.message}</p>
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="timezone" className="block text-sm font-semibold text-slate-300">
                    Timezone
                  </label>
                  <div className="mt-1">
                    <select
                      id="timezone"
                      {...formRegister('timezone')}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-sm text-slate-100 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
                    >
                      <option value="UTC">UTC</option>
                      <option value="America/New_York">America/New_York (EST/EDT)</option>
                      <option value="America/Chicago">America/Chicago (CST/CDT)</option>
                      <option value="America/Denver">America/Denver (MST/MDT)</option>
                      <option value="America/Los_Angeles">America/Los_Angeles (PST/PDT)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-lg text-sm font-bold text-white bg-purple-600 hover:bg-purple-500 active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer shadow-purple-900/10 hover:shadow-purple-900/20"
              >
                {isLoading ? 'Creating Account...' : 'Register'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
