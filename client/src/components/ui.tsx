import React from 'react';
import { type CarrierScore, TIER_STYLE } from '../lib/format';

export const Card: React.FC<{ title?: React.ReactNode; actions?: React.ReactNode; className?: string; children: React.ReactNode }> = ({
  title,
  actions,
  className = '',
  children,
}) => (
  <section className={`bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl ${className}`}>
    {(title || actions) && (
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        {title && <h2 className="text-base font-bold text-slate-100">{title}</h2>}
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    )}
    {children}
  </section>
);

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
const BUTTON_STYLE: Record<ButtonVariant, string> = {
  primary: 'bg-purple-600 hover:bg-purple-500 text-white border-purple-500',
  secondary: 'bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-700',
  danger: 'bg-red-950/60 hover:bg-red-900/60 text-red-300 border-red-800/60',
  success: 'bg-emerald-700 hover:bg-emerald-600 text-white border-emerald-600',
  ghost: 'bg-transparent hover:bg-slate-800 text-slate-300 border-transparent',
};

export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' }
> = ({ variant = 'secondary', size = 'md', className = '', ...props }) => (
  <button
    {...props}
    className={`inline-flex items-center justify-center gap-1.5 rounded-xl border font-semibold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
      size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-4 py-2 text-sm'
    } ${BUTTON_STYLE[variant]} ${className}`}
  />
);

export const inputClass =
  'w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20';

export const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode; className?: string }> = ({
  label,
  hint,
  children,
  className = '',
}) => (
  <label className={`block ${className}`}>
    <span className="block text-xs font-semibold text-slate-300 mb-1">{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-slate-500 mt-1">{hint}</span>}
  </label>
);

export const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }> = ({
  title,
  onClose,
  children,
  wide,
}) => (
  <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto" onClick={onClose}>
    <div
      className={`w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} mt-10 bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl`}
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold">{title}</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none cursor-pointer" aria-label="Close">
          &times;
        </button>
      </div>
      {children}
    </div>
  </div>
);

export const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: string; tone?: 'default' | 'good' | 'warn' | 'bad' }> = ({
  label,
  value,
  hint,
  tone = 'default',
}) => {
  const color = { default: 'text-slate-100', good: 'text-emerald-400', warn: 'text-amber-400', bad: 'text-red-400' }[tone];
  return (
    <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
      <p className="text-[11px] uppercase tracking-wider font-bold text-slate-500">{label}</p>
      <p className={`text-2xl font-extrabold mt-1 ${color}`}>{value}</p>
      {hint && <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>}
    </div>
  );
};

export const Chip: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border border-slate-700 bg-slate-800 text-slate-300 whitespace-nowrap ${className}`}>
    {children}
  </span>
);

export const TierBadge: React.FC<{ score?: CarrierScore | null }> = ({ score }) => {
  if (!score) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${TIER_STYLE[score.tier]}`}>
      {score.tier === 'NEW' ? 'New' : `${score.reliabilityScore} · ${score.tier}`}
      <span className="font-medium opacity-80">{score.tierLabel}</span>
    </span>
  );
};

export const Alert: React.FC<{ kind: 'success' | 'error' | 'info'; children: React.ReactNode; onClose?: () => void }> = ({
  kind,
  children,
  onClose,
}) => {
  const style = {
    success: 'bg-green-950/50 border-green-500/30 text-green-300',
    error: 'bg-red-950/50 border-red-500/30 text-red-300',
    info: 'bg-sky-950/50 border-sky-500/30 text-sky-300',
  }[kind];
  return (
    <div className={`p-3 border rounded-xl text-sm flex justify-between items-start gap-3 ${style}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div>{children}</div>
      {onClose && (
        <button onClick={onClose} className="font-bold opacity-70 hover:opacity-100 cursor-pointer" aria-label="Dismiss">
          &times;
        </button>
      )}
    </div>
  );
};

export const Tabs: React.FC<{ tabs: { id: string; label: string; badge?: number }[]; active: string; onChange: (id: string) => void }> = ({
  tabs,
  active,
  onChange,
}) => (
  <nav className="flex gap-1 overflow-x-auto border-b border-slate-800 mb-6" role="tablist">
    {tabs.map((t) => (
      <button
        key={t.id}
        role="tab"
        aria-selected={active === t.id}
        onClick={() => onChange(t.id)}
        className={`px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors cursor-pointer ${
          active === t.id ? 'border-purple-500 text-purple-300' : 'border-transparent text-slate-400 hover:text-slate-200'
        }`}
      >
        {t.label}
        {!!t.badge && (
          <span className="ml-1.5 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-purple-600 text-white text-[10px]">
            {t.badge}
          </span>
        )}
      </button>
    ))}
  </nav>
);

export const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-sm text-slate-500 text-center py-8">{children}</p>
);
