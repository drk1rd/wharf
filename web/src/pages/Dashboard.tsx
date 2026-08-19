import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Engine, type Instance } from "../lib/api";
import { useToast } from "../components/Toast";

export default function Dashboard() {
  const [instances, setInstances] = useState<Instance[] | null>(null);
  const [engines, setEngines] = useState<Engine[]>([]);
  const [creating, setCreating] = useState<string | null>(null);
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
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(engine: Engine) {
    setCreating(engine.id);
    try {
      const instance = await api.createInstance(`${engine.id}-${Date.now()}`, engine.id, engine.defaultVersion);
      await refresh();
      navigate(`/instances/${instance.id}`);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setCreating(null);
    }
  }

  return (
    <div>
      <div className="hero">
        <h1>Your databases</h1>
        <p>Create a Postgres or MongoDB instance, get a connection URL, and browse the data — all in one place.</p>
      </div>

      <section className="section">
        <h2>New database</h2>
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
                  <span className="engine-name">{engine.displayName}</span>
                  <span className="engine-version">v{engine.defaultVersion}</span>
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
