import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, setAuthToken } from '../api';

export interface User {
  _id: string;
  username: string;
  email: string;
  role: 'SUPER_ADMIN' | 'WAREHOUSE_ADMIN' | 'VENDOR';
  warehouseId?: {
    _id: string;
    name: string;
    address: string;
    timezone: string;
  } | string;
  vendorCompany?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<any>;
  register: (data: any) => Promise<any>;
  logout: () => void;
  isAuthenticated: boolean;
}

const STORAGE_KEY = 'smartdock.session';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Restore a saved session (if its JWT has not expired) before the first render. */
const loadSession = (): { token: string; user: User } | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as { token: string; user: User };
    const payload = JSON.parse(atob(session.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    setAuthToken(session.token);
    return session;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<{ token: string; user: User } | null>(loadSession);

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setAuthToken(null);
    setSession(null);
  };

  // Expired / invalid token or deleted account (e.g. after a demo reset) → back to login
  useEffect(() => {
    const id = api.interceptors.response.use(
      (res) => res,
      (error) => {
        const status = error.response?.status;
        const message = String(error.response?.data?.error ?? '');
        if (status === 401 || (status === 403 && message.includes('Invalid or expired token'))) {
          logout();
        }
        return Promise.reject(error);
      }
    );
    return () => api.interceptors.response.eject(id);
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.post('/api/auth/login', { email, password });
    const { token, user } = res.data;
    setAuthToken(token);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
    setSession({ token, user });
    return res.data;
  };

  const register = async (data: any) => {
    const res = await api.post('/api/auth/register', data);
    return res.data;
  };

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        token: session?.token ?? null,
        login,
        register,
        logout,
        isAuthenticated: !!session,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
