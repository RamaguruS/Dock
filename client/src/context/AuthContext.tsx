import React, { createContext, useContext, useState } from 'react';
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

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const login = async (email: string, password: string) => {
    const res = await api.post('/api/auth/login', { email, password });
    const { token: receivedToken, user: receivedUser } = res.data;
    setToken(receivedToken);
    setUser(receivedUser);
    setAuthToken(receivedToken);
    return res.data;
  };

  const register = async (data: any) => {
    const res = await api.post('/api/auth/register', data);
    return res.data;
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setAuthToken(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
