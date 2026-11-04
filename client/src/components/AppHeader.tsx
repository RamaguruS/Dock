import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { NotificationBell } from './NotificationBell';

export const AppHeader: React.FC<{
  eyebrow: string;
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ eyebrow, title, subtitle, actions }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center lg:justify-between border-b border-slate-800 pb-5 mb-6 gap-4">
      <div className="flex items-center gap-4">
        <div className="hidden sm:flex w-12 h-12 rounded-xl bg-purple-600/15 border border-purple-500/30 text-purple-300 items-center justify-center shrink-0">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l2.414 2.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1" />
          </svg>
        </div>
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-purple-400">{eyebrow}</span>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-slate-100 to-slate-400 bg-clip-text text-transparent">
            {title}
          </h1>
          {subtitle && <div className="text-sm text-slate-400 mt-0.5">{subtitle}</div>}
        </div>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        {actions}
        <NotificationBell />
        <div className="text-right hidden md:block">
          <p className="text-sm font-semibold">{user?.username}</p>
          <p className="text-[11px] text-slate-400">{user?.role === 'VENDOR' ? 'Carrier' : 'Warehouse manager'}</p>
        </div>
        <button
          onClick={() => {
            logout();
            navigate('/login');
          }}
          className="py-2 px-4 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-sm font-semibold cursor-pointer"
        >
          Logout
        </button>
      </div>
    </header>
  );
};
