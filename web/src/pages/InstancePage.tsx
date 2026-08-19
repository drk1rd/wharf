import { useEffect, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type BrowseObject, type ContainerStats, type Instance, type QueryResult } from "../lib/api";
import { formatBytes, formatPercent } from "../lib/format";

type Tab = "simple" | "advanced";

export default function InstancePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [instance, setInstance] = useState<Instance | null>(null);
  const [tab, setTab] = useState<Tab>("simple");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      setInstance(await api.getInstance(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function handleDelete() {
    if (!id || !confirm("Delete this database instance? This cannot be undone.")) return;
    await api.deleteInstance(id);
    navigate("/");
  }

  if (error) return <div className="banner error">{error}</div>;
  if (!instance) return <p>Loading…</p>;

  return (
    <div>
      <div className="instance-header">
        <div>
          <h1>{instance.name}</h1>
          <span className="sub">
            {instance.engine} {instance.version} · <span className={`status status-${instance.status}`}>{instance.status}</span>
          </span>
        </div>
        <button className="danger" onClick={handleDelete}>
          Delete
        </button>
      </div>

      {instance.status === "creating" && <div className="banner info">Provisioning your database — this usually takes 10-30 seconds.</div>}
      {instance.status === "error" && <div className="banner error">Failed to provision: {instance.error}</div>}

      {instance.status === "running" && (
        <>
          <nav className="tabs">
            <button className={tab === "simple" ? "active" : ""} onClick={() => setTab("simple")}>
              Simple
            </button>
            <button className={tab === "advanced" ? "active" : ""} onClick={() => setTab("advanced")}>
              Advanced
            </button>
          </nav>
          {tab === "simple" ? <SimpleView instance={instance} /> : <AdvancedView instance={instance} />}
        </>
      )}
    </div>
  );
}

function SimpleView({ instance }: { instance: Instance }) {
  return (
    <div className="simple-view">
      <ConnectPanel instance={instance} />
      <BrowsePanel instance={instance} />
    </div>
  );
}

function ConnectPanel({ instance }: { instance: Instance }) {
  const conn = instance.connection;
  if (!conn) return null;
  const envVar = instance.engine === "postgres" ? "DATABASE_URL" : "MONGODB_URI";
  const envSnippet = `${envVar}=${conn.connectionString}`;

  return (
    <section className="panel">
      <h2>Connect</h2>
      <CopyField label="Connection URL" value={conn.connectionString} />
      <CopyField label=".env" value={envSnippet} />
    </section>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-field">
      <label>{label}</label>
      <div className="copy-row">
        <code>{value}</code>
        <button
          onClick={() => {
            navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function BrowsePanel({ instance }: { instance: Instance }) {
  const [objects, setObjects] = useState<BrowseObject[]>([]);
  const [selected, setSelected] = useState<BrowseObject | null>(null);
  const [rows, setRows] = useState<QueryResult | null>(null);
  const [queryText, setQueryText] = useState("");
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const label = instance.engine === "mongodb" ? "Collections" : "Tables";

  useEffect(() => {
    api.listObjects(instance.id).then(setObjects).catch(() => setObjects([]));
  }, [instance.id]);

  async function openObject(obj: BrowseObject) {
    setSelected(obj);
    const result = await api.browseObject(instance.id, obj.name, obj.schema, 100, 0);
    setRows(result);
  }

  async function runQuery() {
    setQueryError(null);
    try {
      setQueryResult(await api.runQuery(instance.id, queryText));
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="panel">
      <h2>Browse data</h2>
      <div className="browse-layout">
        <div className="object-list">
          <h3>{label}</h3>
          {objects.length === 0 && <p className="empty">No {label.toLowerCase()} yet.</p>}
          <ul>
            {objects.map((obj) => (
              <li key={`${obj.schema ?? ""}.${obj.name}`}>
                <button className={selected?.name === obj.name ? "active" : ""} onClick={() => openObject(obj)}>
                  {obj.name}
                  {typeof obj.approxRowCount === "number" && <span className="count">{obj.approxRowCount}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="object-rows">
          {rows ? (
            <ResultTable result={rows} />
          ) : (
            <p className="empty">Select a {instance.engine === "mongodb" ? "collection" : "table"} to view its rows.</p>
          )}
        </div>
      </div>

      <div className="query-runner">
        <h3>{instance.engine === "postgres" ? "Run SQL" : 'Run a query — {"collection": "...", "filter": {...}}'}</h3>
        <textarea
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          placeholder={instance.engine === "postgres" ? "select * from my_table limit 50;" : '{"collection": "users", "filter": {}}'}
          rows={4}
        />
        <button onClick={runQuery}>Run</button>
        {queryError && <div className="banner error">{queryError}</div>}
        {queryResult && <ResultTable result={queryResult} />}
      </div>
    </section>
  );
}

function ResultTable({ result }: { result: QueryResult }) {
  if (result.rows.length === 0) return <p className="empty">No rows.</p>;
  const columns = result.columns && result.columns.length > 0 ? result.columns : Object.keys(result.rows[0] as object);
  return (
    <div className="table-scroll">
      <table className="result-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c}>{formatCell((row as Record<string, unknown>)[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function AdvancedView({ instance }: { instance: Instance }) {
  const [stats, setStats] = useState<ContainerStats | null>(null);
  const [logs, setLogs] = useState("");
  const [backups, setBackups] = useState<Awaited<ReturnType<typeof api.listBackups>>>([]);
  const [busy, setBusy] = useState(false);

  const refreshBackups = useCallback(() => {
    api.listBackups(instance.id).then(setBackups).catch(() => undefined);
  }, [instance.id]);

  useEffect(() => {
    const poll = () => {
      api.getMetrics(instance.id).then(setStats).catch(() => undefined);
      api.getLogs(instance.id).then(setLogs).catch(() => undefined);
    };
    poll();
    refreshBackups();
    const interval = setInterval(poll, 4000);
    return () => clearInterval(interval);
  }, [instance.id, refreshBackups]);

  async function handleBackup() {
    setBusy(true);
    try {
      await api.createBackup(instance.id);
      refreshBackups();
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore(backupId: string) {
    if (!confirm("Restore this backup? Current data may be overwritten.")) return;
    setBusy(true);
    try {
      await api.restoreBackup(instance.id, backupId);
      alert("Restore complete.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="advanced-view">
      <section className="panel">
        <h2>Metrics</h2>
        {stats ? (
          <div className="metrics-grid">
            <Metric label="CPU" value={formatPercent(stats.cpuPercent)} />
            <Metric label="Memory" value={`${formatBytes(stats.memUsageBytes)} / ${formatBytes(stats.memLimitBytes)}`} />
            <Metric label="Network RX" value={formatBytes(stats.netRxBytes)} />
            <Metric label="Network TX" value={formatBytes(stats.netTxBytes)} />
            <Metric label="Disk read" value={formatBytes(stats.blkReadBytes)} />
            <Metric label="Disk write" value={formatBytes(stats.blkWriteBytes)} />
          </div>
        ) : (
          <p className="empty">Waiting for metrics…</p>
        )}
      </section>

      <section className="panel">
        <h2>Configuration</h2>
        <dl className="config-list">
          <dt>Engine</dt>
          <dd>
            {instance.engine} {instance.version}
          </dd>
          <dt>CPU limit</dt>
          <dd>{instance.resources.cpu} core(s)</dd>
          <dt>Memory limit</dt>
          <dd>{instance.resources.memoryMb} MB</dd>
          <dt>Disk</dt>
          <dd>{instance.resources.diskGb} GB volume</dd>
          <dt>Created</dt>
          <dd>{new Date(instance.createdAt).toLocaleString()}</dd>
        </dl>
      </section>

      <section className="panel">
        <h2>Backups</h2>
        <button onClick={handleBackup} disabled={busy}>
          {busy ? "Working…" : "Create backup now"}
        </button>
        {backups.length === 0 ? (
          <p className="empty">No backups yet.</p>
        ) : (
          <table className="instance-table">
            <thead>
              <tr>
                <th>Created</th>
                <th>Size</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.id}>
                  <td>{new Date(b.created_at).toLocaleString()}</td>
                  <td>{formatBytes(b.size_bytes)}</td>
                  <td>
                    <button onClick={() => handleRestore(b.id)} disabled={busy}>
                      Restore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Logs</h2>
        <pre className="logs">{logs || "(no logs yet)"}</pre>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </div>
  );
}
