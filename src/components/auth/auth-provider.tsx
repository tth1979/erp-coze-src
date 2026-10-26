'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import type { SessionUser } from '@/lib/types';

type AuthStatus = 'loading' | 'authed' | 'guest';

interface AuthState {
  user: SessionUser | null;
  permissions: string[];
  status: AuthStatus;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

/** AuthStore：永不暴露 token（httpOnly cookie 由浏览器托管） */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [status, setStatus] = useState<AuthStatus>('loading');

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<{ user: SessionUser; permissions: string[] }>('/api/account/me');
      setUser(data.user);
      setPermissions(data.permissions);
      setStatus('authed');
    } catch {
      setUser(null);
      setPermissions([]);
      setStatus('guest');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      setPermissions([]);
      setStatus('guest');
    }
  }, []);

  const can = useCallback(
    (permission: string) => permissions.includes('*') || permissions.includes(permission),
    [permissions],
  );

  const value = useMemo(
    () => ({ user, permissions, status, refresh, logout, can }),
    [user, permissions, status, refresh, logout, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
