import { useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../components/AuthProvider";
import Logo from "../components/Logo";

export default function AuthPage() {
  const { setUser, needsSetup } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Setup and signup are the same call under the hood — the control
      // plane itself promotes whichever account is created first on a
      // fresh instance to superadmin (routes/auth.ts). This screen just
      // labels that moment differently.
      const user = needsSetup || mode === "signup" ? await api.signup(email, password) : await api.login(email, password);
      setUser(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (needsSetup) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-brand">
            <Logo size={28} />
            <span>Wharf</span>
          </div>
          <h1>Create your superadmin account</h1>
          <p className="auth-sub">
            This is a fresh Wharf instance — the first account created here gets full management access to every
            database and every user account on it. You can create more (regular) accounts afterward.
          </p>
          <form onSubmit={submit}>
            <label>
              Email
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </label>
            <label>
              Password
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && <div className="banner error">{error}</div>}
            <button className="primary auth-submit" type="submit" disabled={busy}>
              {busy ? "Working…" : "Create superadmin account"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <Logo size={28} />
          <span>Wharf</span>
        </div>
        <h1>{mode === "login" ? "Sign in" : "Create an account"}</h1>
        <p className="auth-sub">
          {mode === "login" ? "Welcome back to your databases." : "One account, all your database instances."}
        </p>
        <form onSubmit={submit}>
          <label>
            Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <div className="banner error">{error}</div>}
          <button className="primary auth-submit" type="submit" disabled={busy}>
            {busy ? "Working…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
        <button className="ghost auth-switch" onClick={() => setMode((m) => (m === "login" ? "signup" : "login"))}>
          {mode === "login" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
