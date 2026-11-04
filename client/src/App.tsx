import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { PendingApproval } from './pages/PendingApproval';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { VendorDashboard } from './pages/vendor/VendorDashboard';
import { BookingWizard } from './pages/vendor/BookingWizard';
import { GateSheet } from './pages/admin/GateSheet';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const LandingRedirect: React.FC = () => {
  const { user, isAuthenticated } = useAuth();

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role === 'VENDOR') {
    if (user.status !== 'APPROVED') {
      return <Navigate to="/pending-approval" replace />;
    }
    return <Navigate to="/vendor" replace />;
  }

  if (user.role === 'WAREHOUSE_ADMIN' || user.role === 'SUPER_ADMIN') {
    return <Navigate to="/admin" replace />;
  }

  return <Navigate to="/login" replace />;
};

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingRedirect />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/pending-approval" element={<PendingApproval />} />

            {/* Admin Protected Routes */}
            <Route element={<ProtectedRoute allowedRoles={['WAREHOUSE_ADMIN', 'SUPER_ADMIN']} />}>
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/gate-sheet" element={<GateSheet />} />
            </Route>

            {/* Vendor Protected Routes */}
            <Route element={<ProtectedRoute allowedRoles={['VENDOR']} />}>
              <Route path="/vendor" element={<VendorDashboard />} />
              <Route path="/vendor/book" element={<BookingWizard />} />
            </Route>

            {/* Catch-all redirect */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
