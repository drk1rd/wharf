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

  // First-boot setup is two short steps: where this deployment lives (so
  // connection strings and certs are right from the very first database),
  // then the superadmin account itself. Step 1 defaults to "just localhost,
  // no TLS" and can be skipped outright — a local trial shouldn't have to
  // answer a deployment question it doesn't have yet; all of this stays
  // editable later from Settings.
  const [setupStep, setSetupStep] = useState<1 | 2>(1);
  const [hostKind, setHostKind] = useState<"ip" | "domain">("ip");
  const [publicHost, setPublicHost] = useState("");
  const [defaultTls, setDefaultTls] = useState(false);
  const [savingDeployment, setSavingDeployment] = useState(false);

  async function submitDeploymentSettings(e: React.FormEvent) {
    e.preventDefault();
    setSavingDeployment(true);
    setError(null);
    try {
      await api.updateDeploymentSettings({ publicHost: publicHost.trim(), hostKind, defaultTls });
      setSetupStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingDeployment(false);
    }
  }

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

          <div className="setup-steps">
            <span className={`setup-step ${setupStep === 1 ? "active" : "done"}`}>1. Deployment</span>
            <span className={`setup-step ${setupStep === 2 ? "active" : ""}`}>2. Superadmin</span>
          </div>

          {setupStep === 1 ? (
            <>
              <h1>Where does this deployment live?</h1>
              <p className="auth-sub">
                Used to build connection URLs and, if you turn TLS on, the certificate's hostname. You can change any
                of this later from Settings, and it's the same for every database on this instance by default — each
                one can still override TLS individually when you create it.
              </p>
              <form onSubmit={submitDeploymentSettings}>
                <label>
                  Reached by
                  <select value={hostKind} onChange={(e) => setHostKind(e.target.value as "ip" | "domain")}>
                    <option value="ip">IP address</option>
                    <option value="domain">Domain name</option>
                  </select>
                </label>
                <label>
                  {hostKind === "ip" ? "Public IP address" : "Domain name"}
                  <input
                    type="text"
                    placeholder={hostKind === "ip" ? "e.g. 203.0.113.10 (leave blank for localhost)" : "e.g. db.example.com"}
                    value={publicHost}
                    onChange={(e) => setPublicHost(e.target.value)}
                  />
                </label>
                <label className="checkbox-row">
                  <input type="checkbox" checked={defaultTls} onChange={(e) => setDefaultTls(e.target.checked)} />
                  Enable TLS by default for new databases
                </label>
                {error && <div className="banner error">{error}</div>}
                <button className="primary auth-submit" type="submit" disabled={savingDeployment}>
                  {savingDeployment ? "Saving…" : "Continue"}
                </button>
              </form>
              <button className="ghost auth-switch" onClick={() => setSetupStep(2)}>
                Skip — just use localhost, no TLS (you can change this anytime)
              </button>
            </>
          ) : (
            <>
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
              <button className="ghost auth-switch" onClick={() => setSetupStep(1)}>
                ← Back to deployment settings
              </button>
            </>
          )}
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
