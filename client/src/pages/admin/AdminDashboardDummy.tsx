import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export const AdminDashboardDummy: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-100 font-sans">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl relative overflow-hidden">
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-purple-600/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-blue-600/10 rounded-full blur-3xl" />

        <div className="relative z-10 text-center">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-purple-950/50 border border-purple-500/30 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </div>
          </div>

          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-slate-100 to-slate-400 bg-clip-text text-transparent">
            Admin Dashboard
          </h1>
          <p className="text-slate-400 mt-2">
            Welcome back, <span className="text-purple-400 font-semibold">{user?.username}</span>
          </p>

          <div className="mt-6 p-4 rounded-xl bg-slate-950/50 border border-slate-800 text-left text-sm space-y-2">
            <p className="text-slate-400">Role: <span className="text-slate-200">{user?.role}</span></p>
            <p className="text-slate-400">Warehouse ID: <span className="text-slate-200">{typeof user?.warehouseId === 'object' ? user.warehouseId._id : user?.warehouseId}</span></p>
          </div>

          <button
            onClick={handleLogout}
            className="w-full mt-8 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-98 font-semibold text-sm transition-all border border-slate-700 cursor-pointer shadow-lg"
          >
            Log Out
          </button>
        </div>
      </div>
    </div>
  );
};
