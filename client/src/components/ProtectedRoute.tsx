import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface ProtectedRouteProps {
  allowedRoles?: ('SUPER_ADMIN' | 'WAREHOUSE_ADMIN' | 'VENDOR')[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ allowedRoles }) => {
  const { user, isAuthenticated } = useAuth();

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  // If a vendor is not approved, send them to the pending approval screen
  if (user.role === 'VENDOR' && user.status !== 'APPROVED') {
    return <Navigate to="/pending-approval" replace />;
  }

  // If there are specific roles allowed for this route and the current user doesn't have it
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    if (user.role === 'WAREHOUSE_ADMIN' || user.role === 'SUPER_ADMIN') {
      return <Navigate to="/admin" replace />;
    }
    if (user.role === 'VENDOR') {
      return <Navigate to="/vendor" replace />;
    }
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};
