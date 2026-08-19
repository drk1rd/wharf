import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Engine, type Instance } from "../lib/api";

export default function Dashboard() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [engines, setEngines] = useState<Engine[]>([]);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function refresh() {
    try {
      setInstances(await api.listInstances());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    api.listEngines().then(setEngines).catch((err) => setError(err.message));
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, []);

  async function handleCreate(engine: Engine) {
    setCreating(engine.id);
    setError(null);
    try {
      const instance = await api.createInstance(`${engine.id}-${Date.now()}`, engine.id, engine.defaultVersion);
      await refresh();
      navigate(`/instances/${instance.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(null);
    }
  }

  return (
    <div>
      <section className="create-row">
        <h2>New database</h2>
        <div className="engine-cards">
          {engines.map((engine) => (
            <button
              key={engine.id}
              className="engine-card"
              onClick={() => handleCreate(engine)}
              disabled={creating !== null}
            >
              <span className="engine-name">{engine.displayName}</span>
              <span className="engine-version">v{engine.defaultVersion}</span>
              <span className="engine-cta">{creating === engine.id ? "Creating…" : "Create"}</span>
            </button>
          ))}
        </div>
      </section>

      {error && <div className="banner error">{error}</div>}

      <section>
        <h2>Your databases</h2>
        {instances.length === 0 ? (
          <p className="empty">Nothing here yet — create one above.</p>
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
                  <td>{instance.name}</td>
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
