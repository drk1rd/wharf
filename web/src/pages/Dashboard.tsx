import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Engine, type Instance } from "../lib/api";
import { useToast } from "../components/Toast";

// One consistent glyph for every engine card, not a set of five per-engine
// mini-logos — trying to hand-draw five brand-accurate marks risks looking
// worse than no icon at all, and a single restrained "database" glyph
// (the standard stacked-cylinder shape) reads as considered without
// reaching for personality the cards don't need.
function DbIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
      <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
    </svg>
  );
}

export default function Dashboard() {
  const [instances, setInstances] = useState<Instance[] | null>(null);
  const [engines, setEngines] = useState<Engine[]>([]);
  const [creating, setCreating] = useState<string | null>(null);
  // One toggle for the whole card grid, not a per-engine option — TLS is a
  // create-time-only choice anyway (see PLAN.md), so a single "use TLS for
  // whatever I create next" switch stays true to the "not that complex"
  // brief while still being overridable per click. Seeded from the
  // deployment default set in Settings/the setup wizard; engines with no
  // TLS support (Redis, ClickHouse) just ignore it.
  const [tlsWanted, setTlsWanted] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  async function refresh() {
    try {
      setInstances(await api.listInstances());
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    }
  }

  useEffect(() => {
    api.listEngines().then(setEngines).catch((err) => toast.push(err.message, "error"));
    api.getDeploymentSettings().then((s) => setTlsWanted(s.defaultTls)).catch(() => undefined);
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(engine: Engine) {
    setCreating(engine.id);
    try {
      const instance = await api.createInstance(`${engine.id}-${Date.now()}`, engine.id, engine.defaultVersion, tlsWanted);
      await refresh();
      navigate(`/instances/${instance.id}`);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setCreating(null);
    }
  }

  const runningCount = instances?.filter((i) => i.status === "running").length ?? 0;
  const tlsCount = instances?.filter((i) => i.tlsEnabled).length ?? 0;

  return (
    <div>
      <div className="hero">
        <h1>Your databases</h1>
        <p>Create a Postgres, MySQL, ClickHouse, MongoDB, or Redis instance, get a connection URL, and browse the data — all in one place.</p>
      </div>

      {instances !== null && instances.length > 0 && (
        <div className="stats-row">
          <div className="metric">
            <span className="metric-label">Databases</span>
            <span className="metric-value">{instances.length}</span>
          </div>
          <div className="metric">
            <span className="metric-label">Running</span>
            <span className="metric-value">{runningCount}</span>
          </div>
          <div className="metric">
            <span className="metric-label">TLS-enabled</span>
            <span className="metric-value">{tlsCount}</span>
          </div>
        </div>
      )}

      <section className="section">
        <div className="section-heading-row">
          <h2>New database</h2>
          <label className="checkbox-row tls-toggle" title="Encrypt the connection with a certificate signed by this deployment's own CA. Not every engine supports it yet.">
            <input type="checkbox" checked={tlsWanted} onChange={(e) => setTlsWanted(e.target.checked)} />
            Use TLS
          </label>
        </div>
        <div className="engine-cards">
          {engines.length === 0
            ? [0, 1].map((i) => <div key={i} className="engine-card skeleton" style={{ height: 78 }} />)
            : engines.map((engine) => (
                <button
                  key={engine.id}
                  className="engine-card"
                  onClick={() => handleCreate(engine)}
                  disabled={creating !== null}
                >
                  <span className="engine-icon">
                    <DbIcon />
                  </span>
                  <span className="engine-name">{engine.displayName}</span>
                  <span className="engine-version">
                    {/^\d/.test(engine.defaultVersion) ? `v${engine.defaultVersion}` : engine.defaultVersion}
                    {tlsWanted && !engine.tlsSupported && <span className="engine-no-tls"> · no TLS yet</span>}
                  </span>
                  <span className="engine-cta">
                    {creating === engine.id ? (
                      <>
                        <span className="spinner" /> Creating…
                      </>
                    ) : (
                      "Create instance →"
                    )}
                  </span>
                </button>
              ))}
        </div>
      </section>

      <section className="section">
        <h2>Instances</h2>
        {instances === null ? (
          <div className="skeleton" style={{ height: 120, borderRadius: "var(--radius)" }} />
        ) : instances.length === 0 ? (
          <div className="empty-block">Nothing here yet — create a database above to get started.</div>
        ) : (
          <table className="instance-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Engine</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {instances.map((instance) => (
                <tr key={instance.id} onClick={() => navigate(`/instances/${instance.id}`)} className="row-link">
                  <td className="instance-name">{instance.name}</td>
                  <td>
                    {instance.engine} {instance.version}
                  </td>
                  <td>
                    <span className={`status status-${instance.status}`}>{instance.status}</span>
                  </td>
                  <td>{new Date(instance.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
