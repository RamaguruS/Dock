import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export const PendingApproval: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isRejected = user?.status === 'REJECTED';

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-100 font-sans">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl relative overflow-hidden">
        {/* Decorative backdrop light */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-purple-600/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-blue-600/20 rounded-full blur-3xl" />

        <div className="relative z-10 text-center">
          {/* Visual icon */}
          <div className="flex justify-center mb-6">
            {isRejected ? (
              <div className="w-16 h-16 bg-red-950/50 border border-red-500/30 rounded-full flex items-center justify-center animate-pulse">
                <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            ) : (
              <div className="w-16 h-16 bg-amber-950/50 border border-amber-500/30 rounded-full flex items-center justify-center animate-pulse">
                <svg className="w-8 h-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            )}
          </div>

          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-slate-100 to-slate-400 bg-clip-text text-transparent">
            {isRejected ? 'Account Rejected' : 'Awaiting Approval'}
          </h1>
          <p className="text-sm text-slate-400 mt-2 font-medium">
            Company: <span className="text-slate-200">{user?.vendorCompany || 'N/A'}</span>
          </p>

          <div className="mt-6 p-4 rounded-xl bg-slate-950/50 border border-slate-800 text-sm leading-relaxed text-slate-300">
            {isRejected ? (
              <span>
                Unfortunately, your request to register as an active Vendor operator on SmartDock has been declined by the warehouse administrative team. Please contact the administrator for details.
              </span>
            ) : (
              <span>
                Thank you for registering! Your vendor account is currently pending approval by a Warehouse Administrator. Once approved, you'll be able to access the booking panel, view available docks, and schedule booking timeslots.
              </span>
            )}
          </div>

          <button
            onClick={handleLogout}
            className="w-full mt-8 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-98 font-semibold text-sm transition-all border border-slate-700 cursor-pointer shadow-lg hover:shadow-slate-850"
          >
            Log Out & Return
          </button>
        </div>
      </div>
    </div>
  );
};
