import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type User } from "../lib/api";

interface AuthState {
  loading: boolean;
  authRequired: boolean;
  user: User | null;
  refresh: () => Promise<void>;
  setUser: (user: User | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const config = await api.getConfig();
      setAuthRequired(config.authRequired);
      if (!config.authRequired) {
        setUser(null);
        return;
      }
      try {
        setUser(await api.me());
      } catch {
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function logout() {
    await api.logout().catch(() => undefined);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ loading, authRequired, user, refresh, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
