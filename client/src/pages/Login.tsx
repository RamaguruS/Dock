import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

interface DemoInfo {
  demoMode: boolean;
  accounts?: { label: string; email: string; password: string }[];
}

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type LoginForm = z.infer<typeof loginSchema>;

export const Login: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [apiError, setApiError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const [params] = useSearchParams();
  const { data: demo } = useQuery<DemoInfo>({
    queryKey: ['demoInfo'],
    queryFn: async () => (await api.get('/api/demo/info')).data,
    retry: false,
  });

  const onSubmit = async (data: LoginForm) => {
    setIsLoading(true);
    setApiError(null);
    try {
      const result = await login(data.email, data.password);
      const role = result.user.role;
      const status = result.user.status;

      if (role === 'VENDOR' && status !== 'APPROVED') {
        navigate('/pending-approval');
      } else if (role === 'WAREHOUSE_ADMIN' || role === 'SUPER_ADMIN') {
        navigate('/admin');
      } else {
        navigate('/vendor');
      }
    } catch (err: any) {
      setApiError(err.response?.data?.error || 'Invalid credentials or connection issue.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-slate-100 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        {/* Visual Logo */}
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-purple-600/10 border border-purple-500/20 text-purple-400 mb-4">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-slate-100 to-slate-400 bg-clip-text text-transparent">
          Sign in to SmartDock
        </h2>
        <p className="mt-2 text-sm text-slate-400 max-w-sm mx-auto">
          Dock appointment scheduling &amp; yard management for warehouses, distribution centres and their carriers.
        </p>
        <p className="mt-2 text-sm text-slate-400">
          Or{' '}
          <Link to="/register" className="font-semibold text-purple-400 hover:text-purple-300 transition-colors">
            create a new account
          </Link>
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-slate-900 border border-slate-800 py-8 px-4 shadow-2xl rounded-2xl sm:px-10 relative overflow-hidden">
          {/* Decorative backdrop light */}
          <div className="absolute -top-24 -left-24 w-48 h-48 bg-purple-600/10 rounded-full blur-3xl" />

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 relative z-10">
            {params.get('reset') && (
              <div className="rounded-xl bg-sky-950/50 border border-sky-500/30 p-3 text-sm text-sky-300">
                Demo data was regenerated. Please sign in again.
              </div>
            )}
            {apiError && (
              <div className="rounded-xl bg-red-950/50 border border-red-500/30 p-4 text-sm text-red-400 flex items-start space-x-2">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>{apiError}</span>
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-slate-300">
                Email Address
              </label>
              <div className="mt-1">
                <input
                  id="email"
                  type="email"
                  {...register('email')}
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
                  {...register('password')}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all"
                  placeholder="••••••••"
                />
                {errors.password && (
                  <p className="mt-1 text-xs text-red-400 font-medium">{errors.password.message}</p>
                )}
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-lg text-sm font-bold text-white bg-purple-600 hover:bg-purple-500 active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer shadow-purple-900/10 hover:shadow-purple-900/20"
              >
                {isLoading ? 'Signing in...' : 'Sign In'}
              </button>
            </div>
          </form>
        </div>

        {demo?.demoMode && (
          <div className="mt-6 bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-purple-400 mb-3">Demo accounts</p>
            <div className="space-y-2">
              {demo.accounts?.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  onClick={() => {
                    setValue('email', a.email);
                    setValue('password', a.password);
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 hover:border-purple-500/50 cursor-pointer"
                >
                  <span className="block text-sm font-semibold text-slate-200">{a.label}</span>
                  <span className="block text-xs text-slate-500">{a.email} · {a.password}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-3">Click an account to fill the form, then press Sign In.</p>
          </div>
        )}
      </div>
    </div>
  );
};
