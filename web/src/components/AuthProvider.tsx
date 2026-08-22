import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type User } from "../lib/api";

interface AuthState {
  loading: boolean;
  needsSetup: boolean;
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
  const [needsSetup, setNeedsSetup] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  // There's no anonymous-access bootstrap window anymore — every path
  // through this needs either a real session (checked below) or, before
  // one exists, needsSetup routes the app to the superadmin setup screen
  // instead (see App.tsx's Shell).
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const config = await api.getConfig();
      setNeedsSetup(config.needsSetup);
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
    <AuthContext.Provider value={{ loading, needsSetup, user, refresh, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
