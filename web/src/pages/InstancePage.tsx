import { useEffect, useState, useCallback, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  api,
  type ApiToken,
  type AskResult,
  type AuditLogEntry,
  type BrowseObject,
  type ContainerStats,
  type Instance,
  type OpenRouterModel,
  type QueryResult,
} from "../lib/api";
import { formatBytes, formatPercent } from "../lib/format";
import { downloadResultAsCsv, downloadResultAsJson } from "../lib/export";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { useAuth } from "../components/AuthProvider";

type Tab = "simple" | "advanced";

function envVarFor(engine: string): string {
  switch (engine) {
    case "postgres":
    case "mysql":
    case "clickhouse":
      return "DATABASE_URL";
    case "mongodb":
      return "MONGODB_URI";
    case "redis":
      return "REDIS_URL";
    default:
      return "DATABASE_URL";
  }
}

interface FrameworkSnippet {
  label: string;
  code: string;
}

// Never inlines the actual secret — every snippet reads from the env var
// shown right above it in the .env block, which is both safer to display
// (no live password rendered into a copy-paste code sample) and more
// realistic (that's how you'd actually wire it into an app).
function frameworkSnippets(engine: string, envVar: string): FrameworkSnippet[] {
  switch (engine) {
    case "postgres":
      return [
        {
          label: "Node.js (pg)",
          code: `import { Client } from "pg";\n\nconst client = new Client({ connectionString: process.env.${envVar} });\nawait client.connect();\n\nconst { rows } = await client.query("SELECT * FROM customers LIMIT 10");`,
        },
        {
          label: "Prisma",
          code: `// prisma/schema.prisma\ndatasource db {\n  provider = "postgresql"\n  url      = env("${envVar}")\n}`,
        },
        {
          label: "Python (psycopg2)",
          code: `import os\nimport psycopg2\n\nconn = psycopg2.connect(os.environ["${envVar}"])\ncur = conn.cursor()\ncur.execute("SELECT * FROM customers LIMIT 10")\nrows = cur.fetchall()`,
        },
      ];
    case "mysql":
      return [
        {
          label: "Node.js (mysql2)",
          code: `import mysql from "mysql2/promise";\n\nconst conn = await mysql.createConnection(process.env.${envVar});\nconst [rows] = await conn.query("SELECT * FROM customers LIMIT 10");`,
        },
        {
          label: "Prisma",
          code: `// prisma/schema.prisma\ndatasource db {\n  provider = "mysql"\n  url      = env("${envVar}")\n}`,
        },
        {
          label: "Python (mysql-connector)",
          code: `import os\nimport mysql.connector\nfrom urllib.parse import urlparse\n\nurl = urlparse(os.environ["${envVar}"])\nconn = mysql.connector.connect(\n    host=url.hostname, port=url.port,\n    user=url.username, password=url.password,\n    database=url.path.lstrip("/"),\n)`,
        },
      ];
    case "mongodb":
      return [
        {
          label: "Node.js (mongodb)",
          code: `import { MongoClient } from "mongodb";\n\nconst client = new MongoClient(process.env.${envVar});\nawait client.connect();\n\nconst docs = await client.db().collection("customers").find().limit(10).toArray();`,
        },
        {
          label: "Mongoose",
          code: `import mongoose from "mongoose";\n\nawait mongoose.connect(process.env.${envVar});`,
        },
        {
          label: "Python (pymongo)",
          code: `import os\nfrom pymongo import MongoClient\n\nclient = MongoClient(os.environ["${envVar}"])\ndocs = list(client.get_default_database().customers.find().limit(10))`,
        },
      ];
    case "redis":
      return [
        {
          label: "Node.js (ioredis)",
          code: `import Redis from "ioredis";\n\nconst redis = new Redis(process.env.${envVar});\nconst value = await redis.get("session:demo");`,
        },
        {
          label: "Node.js (redis)",
          code: `import { createClient } from "redis";\n\nconst client = createClient({ url: process.env.${envVar} });\nawait client.connect();\n\nconst value = await client.get("session:demo");`,
        },
        {
          label: "Python (redis-py)",
          code: `import os\nimport redis\n\nr = redis.from_url(os.environ["${envVar}"])\nvalue = r.get("session:demo")`,
        },
      ];
    case "clickhouse":
      return [
        {
          label: "Node.js (@clickhouse/client)",
          code: `import { createClient } from "@clickhouse/client";\n\nconst client = createClient({ url: process.env.${envVar} });\nconst result = await client.query({ query: "SELECT * FROM customers LIMIT 10", format: "JSONEachRow" });\nconst rows = await result.json();`,
        },
        {
          label: "Python (clickhouse-connect)",
          code: `import os\nimport clickhouse_connect\n\nclient = clickhouse_connect.get_client(dsn=os.environ["${envVar}"])\nrows = client.query("SELECT * FROM customers LIMIT 10").result_rows`,
        },
      ];
    default:
      return [];
  }
}

function queryRunnerLabel(engine: string): string {
  switch (engine) {
    case "postgres":
    case "mysql":
    case "clickhouse":
      return "Run SQL";
    case "redis":
      return "Run a command";
    default:
      return "Run a query";
  }
}

function queryRunnerPlaceholder(engine: string): string {
  switch (engine) {
    case "postgres":
    case "mysql":
    case "clickhouse":
      return "select * from my_table limit 50;";
    case "redis":
      return "GET my_key";
    default:
      return '{"collection": "users", "filter": {}}';
  }
}

export default function InstancePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [instance, setInstance] = useState<Instance | null>(null);
  const [tab, setTab] = useState<Tab>("simple");

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      setInstance(await api.getInstance(id));
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function handleDelete() {
    if (!id) return;
    const ok = await confirmDialog({
      title: "Delete this database?",
      description: `${instance?.name ?? "This instance"} and its data will be permanently removed. This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteInstance(id);
      toast.push("Instance deleted.", "success");
      navigate("/");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    }
  }

  if (!instance) {
    return <div className="skeleton" style={{ height: 200, borderRadius: "var(--radius)" }} />;
  }

  return (
    <div>
      <Link to="/" className="back-link">
        ← All instances
      </Link>
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

      {instance.status === "creating" && (
        <div className="banner info">
          <span className="spinner" style={{ marginRight: 8 }} />
          Provisioning your database — this usually takes 10-30 seconds.
        </div>
      )}
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
      <AskPanel instance={instance} />
      <BrowsePanel instance={instance} />
    </div>
  );
}

function AskPanel({ instance }: { instance: Instance }) {
  const toast = useToast();
  const { user } = useAuth();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [model, setModel] = useState("");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AskResult | null>(null);

  useEffect(() => {
    api
      .getConfig()
      .then((c) => setEnabled(c.askEnabled))
      .catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    api
      .listModels()
      .then((list) => {
        setModels(list);
        setModel((current) => current || user?.defaultModel || list[0]?.id || "");
      })
      .catch(() => setModels([]));
  }, [enabled, user?.defaultModel]);

  async function handleAsk() {
    if (!question.trim() || !model || asking) return;
    setAsking(true);
    setAnswer(null);
    try {
      setAnswer(await api.ask(instance.id, question, model));
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setAsking(false);
    }
  }

  if (enabled === null) return null;
  const supported = instance.engine !== "redis";

  return (
    <section className="panel">
      <h2>Ask your data</h2>
      {!supported ? (
        <p className="empty">Not available for key-value stores yet — a single generated command doesn't map cleanly to an arbitrary question.</p>
      ) : !enabled ? (
        <p className="empty">
          Set <code>OPENROUTER_API_KEY</code> on the control plane to ask questions in plain English instead of writing queries by hand.
        </p>
      ) : (
        <>
          {models.length > 0 && (
            <div className="copy-field">
              <label>Model</label>
              <select className="model-select-inline" value={model} onChange={(e) => setModel(e.target.value)}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="ask-row">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAsk()}
              placeholder="e.g. how many rows were added in the last 7 days?"
            />
            <button className="primary" onClick={handleAsk} disabled={asking || !question.trim() || !model}>
              {asking ? <span className="spinner" /> : "Ask"}
            </button>
          </div>
          {answer && (
            <div className="ask-answer">
              <p className="ask-explanation">{answer.explanation}</p>
              <code className="ask-query">{answer.query}</code>
              <ResultTable result={answer.result} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ConnectPanel({ instance }: { instance: Instance }) {
  const conn = instance.connection;
  const [revealed, setRevealed] = useState(false);
  const snippets = frameworkSnippets(instance.engine, envVarFor(instance.engine));
  const [snippetIndex, setSnippetIndex] = useState(0);
  if (!conn) return null;
  const envVar = envVarFor(instance.engine);
  const masked = conn.connectionString.replace(/:([^:@/]+)@/, ":••••••••@");
  const display = revealed ? conn.connectionString : masked;
  const envSnippet = `${envVar}=${display}`;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Connect</h2>
        <button className="ghost" onClick={() => setRevealed((r) => !r)}>
          {revealed ? "Hide password" : "Reveal password"}
        </button>
      </div>
      <CopyField label="Connection URL" value={display} copyValue={conn.connectionString} />
      <CopyField label=".env" value={envSnippet} copyValue={`${envVar}=${conn.connectionString}`} />
      {snippets.length > 0 && (
        <div className="copy-field">
          <div className="snippet-head">
            <label>Code snippet</label>
            <select value={snippetIndex} onChange={(e) => setSnippetIndex(Number(e.target.value))}>
              {snippets.map((s, i) => (
                <option key={s.label} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <CodeBlock code={snippets[snippetIndex].code} />
        </div>
      )}
    </section>
  );
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-block">
      <pre>
        <code>{code}</code>
      </pre>
      <button
        className="code-block-copy"
        onClick={() => {
          navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function CopyField({ label, value, copyValue }: { label: string; value: string; copyValue?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-field">
      <label>{label}</label>
      <div className="copy-row">
        <code>{value}</code>
        <button
          onClick={() => {
            navigator.clipboard.writeText(copyValue ?? value);
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
  const toast = useToast();
  const [objects, setObjects] = useState<BrowseObject[]>([]);
  const [selected, setSelected] = useState<BrowseObject | null>(null);
  const [rows, setRows] = useState<QueryResult | null>(null);
  const [queryText, setQueryText] = useState("");
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importTarget, setImportTarget] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const label = instance.engine === "mongodb" ? "Collections" : instance.engine === "redis" ? "Keys" : "Tables";
  const singular = instance.engine === "mongodb" ? "collection" : instance.engine === "redis" ? "key" : "table";

  const refreshObjects = useCallback(() => {
    api.listObjects(instance.id).then(setObjects).catch(() => setObjects([]));
  }, [instance.id]);

  useEffect(() => {
    refreshObjects();
  }, [refreshObjects]);

  async function openObject(obj: BrowseObject) {
    setSelected(obj);
    try {
      setRows(await api.browseObject(instance.id, obj.name, obj.schema, 100, 0));
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function runQuery() {
    setRunning(true);
    try {
      setQueryResult(await api.runQuery(instance.id, queryText));
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setRunning(false);
    }
  }

  async function handleImportFile(file: File) {
    if (instance.engine !== "redis" && !importTarget.trim()) {
      toast.push(`Enter a ${singular} name before importing.`, "error");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const format = file.name.toLowerCase().endsWith(".json") ? "json" : "csv";
    setImporting(true);
    try {
      const text = await file.text();
      const result = await api.importData(instance.id, format, importTarget.trim(), text);
      toast.push(`Imported ${result.inserted} row${result.inserted === 1 ? "" : "s"}.`, "success");
      refreshObjects();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <section className="panel">
      <h2>Browse data</h2>
      <div className="browse-layout">
        <div className="object-list">
          <h3>{label}</h3>
          <div className="import-row">
            {instance.engine !== "redis" && (
              <input
                type="text"
                className="import-target"
                placeholder={`${singular} name`}
                value={importTarget}
                onChange={(e) => setImportTarget(e.target.value)}
                disabled={importing}
              />
            )}
            <label className={`ghost import-button${importing ? " disabled" : ""}`}>
              {importing ? "Importing…" : "Import CSV/JSON"}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.json"
                disabled={importing}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImportFile(file);
                }}
              />
            </label>
          </div>
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
            <p className="empty">Select a {singular} to view its {instance.engine === "redis" ? "value" : "rows"}.</p>
          )}
        </div>
      </div>

      <div className="query-runner">
        <h3>{queryRunnerLabel(instance.engine)}</h3>
        <textarea
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          placeholder={queryRunnerPlaceholder(instance.engine)}
          rows={4}
        />
        <button className="primary" onClick={runQuery} disabled={running || !queryText.trim()}>
          {running ? "Running…" : "Run"}
        </button>
        {queryResult && (
          <div style={{ marginTop: 14 }}>
            <ResultTable result={queryResult} />
          </div>
        )}
      </div>
    </section>
  );
}

function ResultTable({ result, exportName = "wharf-export" }: { result: QueryResult; exportName?: string }) {
  if (result.rows.length === 0) return <p className="empty">No rows.</p>;
  const columns = result.columns && result.columns.length > 0 ? result.columns : Object.keys(result.rows[0] as object);
  return (
    <div>
      <div className="export-row">
        <button className="ghost" onClick={() => downloadResultAsCsv(result, exportName)}>
          Export CSV
        </button>
        <button className="ghost" onClick={() => downloadResultAsJson(result, exportName)}>
          Export JSON
        </button>
      </div>
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
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function AdvancedView({ instance }: { instance: Instance }) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const navigate = useNavigate();
  const [branching, setBranching] = useState(false);
  const [stats, setStats] = useState<ContainerStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [logs, setLogs] = useState("");
  const [logsError, setLogsError] = useState<string | null>(null);
  const [backups, setBackups] = useState<Awaited<ReturnType<typeof api.listBackups>>>([]);
  const [busy, setBusy] = useState(false);
  const [cpuInput, setCpuInput] = useState(instance.resources.cpu);
  const [memInput, setMemInput] = useState(String(instance.resources.memoryMb));
  const [resizing, setResizing] = useState(false);
  const [schedule, setSchedule] = useState(instance.backupSchedule);
  const [intervalInput, setIntervalInput] = useState(String(instance.backupSchedule?.intervalHours ?? 24));
  const [retentionInput, setRetentionInput] = useState(String(instance.backupSchedule?.retentionCount ?? 7));
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [tokenName, setTokenName] = useState("");
  const [tokenScope, setTokenScope] = useState<"read" | "write">("read");
  const [minting, setMinting] = useState(false);
  const [justMinted, setJustMinted] = useState<string | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);

  const refreshTokens = useCallback(() => {
    api.listTokens(instance.id).then(setTokens).catch(() => undefined);
  }, [instance.id]);

  const refreshAuditLog = useCallback(() => {
    api.listAuditLog(instance.id).then(setAuditLog).catch(() => undefined);
  }, [instance.id]);

  const refreshBackups = useCallback(() => {
    api.listBackups(instance.id).then(setBackups).catch(() => undefined);
  }, [instance.id]);

  useEffect(() => {
    const poll = () => {
      api
        .getMetrics(instance.id)
        .then((s) => {
          setStats(s);
          setStatsError(null);
        })
        .catch((err) => setStatsError(err instanceof Error ? err.message : String(err)));
      api
        .getLogs(instance.id)
        .then((l) => {
          setLogs(l);
          setLogsError(null);
        })
        .catch((err) => setLogsError(err instanceof Error ? err.message : String(err)));
    };
    poll();
    refreshBackups();
    refreshTokens();
    refreshAuditLog();
    const interval = setInterval(poll, 4000);
    return () => clearInterval(interval);
  }, [instance.id, refreshBackups, refreshTokens, refreshAuditLog]);

  async function handleResize() {
    setResizing(true);
    try {
      await api.resizeInstance(instance.id, cpuInput, Number(memInput));
      toast.push("Resized — takes effect immediately, no restart.", "success");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setResizing(false);
    }
  }

  async function handleBranch() {
    setBranching(true);
    try {
      toast.push("Creating a branch — this copies the current data into a new instance, can take a minute…", "success");
      const branch = await api.createBranch(instance.id);
      toast.push(`Branch "${branch.name}" is ready.`, "success");
      navigate(`/instances/${branch.id}`);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBranching(false);
    }
  }

  async function handleBackup() {
    setBusy(true);
    try {
      await api.createBackup(instance.id);
      refreshBackups();
      toast.push("Backup created.", "success");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSchedule() {
    setSavingSchedule(true);
    try {
      const result = await api.setBackupSchedule(instance.id, Number(intervalInput), Number(retentionInput));
      setSchedule(result);
      toast.push("Backup schedule saved.", "success");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSavingSchedule(false);
    }
  }

  async function handleDisableSchedule() {
    setSavingSchedule(true);
    try {
      await api.setBackupSchedule(instance.id, null);
      setSchedule(null);
      toast.push("Backup schedule disabled.", "success");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSavingSchedule(false);
    }
  }

  async function handleMintToken() {
    setMinting(true);
    try {
      const result = await api.mintToken(instance.id, tokenScope, tokenName.trim());
      setJustMinted(result.token);
      setTokenName("");
      refreshTokens();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setMinting(false);
    }
  }

  async function handleRevokeToken(tokenId: string) {
    const ok = await confirmDialog({
      title: "Revoke this token?",
      description: "Anything using it will immediately lose access to this instance.",
      confirmLabel: "Revoke",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.revokeToken(instance.id, tokenId);
      refreshTokens();
      toast.push("Token revoked.", "success");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function handleRestore(backupId: string) {
    const ok = await confirmDialog({
      title: "Restore this backup?",
      description: "Current data may be overwritten by the contents of this backup.",
      confirmLabel: "Restore",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.restoreBackup(instance.id, backupId);
      toast.push("Restore complete.", "success");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
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
        ) : statsError ? (
          <p className="empty">Metrics unavailable: {statsError}</p>
        ) : (
          <div className="metrics-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="metric skeleton" style={{ height: 52 }} />
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Configuration</h2>
        <dl className="config-list">
          <dt>Engine</dt>
          <dd>
            {instance.engine} {instance.version}
          </dd>
          <dt>Disk</dt>
          <dd>{instance.resources.diskGb} GB volume</dd>
          <dt>Created</dt>
          <dd>{new Date(instance.createdAt).toLocaleString()}</dd>
        </dl>

        <div className="resize-row">
          <label>
            CPU (cores)
            <input type="text" value={cpuInput} onChange={(e) => setCpuInput(e.target.value)} />
          </label>
          <label>
            Memory (MB)
            <input type="number" value={memInput} onChange={(e) => setMemInput(e.target.value)} />
          </label>
          <button className="primary" onClick={handleResize} disabled={resizing}>
            {resizing ? "Resizing…" : "Resize"}
          </button>
        </div>
        <p className="empty">Takes effect immediately, no restart. Disk isn't live-resizable — a volume would need to be migrated.</p>
      </section>

      <section className="panel">
        <h2>Branching</h2>
        <p className="empty">
          Creates a brand-new, fully independent instance starting from this one's current data — safe to test a risky query or
          migration against, without touching this instance. Takes a minute or two, since it provisions a whole new database.
        </p>
        <button onClick={handleBranch} disabled={branching}>
          {branching ? "Creating branch…" : "Create a branch"}
        </button>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Backups</h2>
          {instance.backupSupported && (
            <button className="primary" onClick={handleBackup} disabled={busy}>
              {busy ? "Working…" : "Create backup now"}
            </button>
          )}
        </div>
        {instance.backupSupported && (
          <div className="schedule-row">
            <label>
              Every
              <select value={intervalInput} onChange={(e) => setIntervalInput(e.target.value)} disabled={savingSchedule}>
                <option value="6">6 hours</option>
                <option value="24">24 hours</option>
                <option value="168">7 days</option>
              </select>
            </label>
            <label>
              Keep last
              <input
                type="number"
                min={1}
                max={100}
                value={retentionInput}
                onChange={(e) => setRetentionInput(e.target.value)}
                disabled={savingSchedule}
              />
            </label>
            <button onClick={handleSaveSchedule} disabled={savingSchedule}>
              {schedule ? "Update schedule" : "Enable schedule"}
            </button>
            {schedule && (
              <button className="ghost" onClick={handleDisableSchedule} disabled={savingSchedule}>
                Disable
              </button>
            )}
            {schedule && (
              <span className="schedule-status">
                {schedule.lastRunAt ? `Last ran ${new Date(schedule.lastRunAt).toLocaleString()}` : "Not run yet"}
              </span>
            )}
          </div>
        )}
        {!instance.backupSupported ? (
          <p className="empty">Backup/restore isn't supported for {instance.engine} yet.</p>
        ) : backups.length === 0 ? (
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
        <h2>API tokens</h2>
        <p className="empty">
          Scoped to this instance only — a "read" token can view data but not run queries, resize, back up, restore, or delete; a
          "write" token can do everything to this instance except create new instances or manage its own tokens.
        </p>
        {justMinted && (
          <div className="minted-token">
            <label>New token — copy it now, it won't be shown again</label>
            <div className="copy-row">
              <code>{justMinted}</code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(justMinted);
                  toast.push("Copied.", "success");
                }}
              >
                Copy
              </button>
            </div>
            <button className="ghost" onClick={() => setJustMinted(null)}>
              Dismiss
            </button>
          </div>
        )}
        <div className="schedule-row">
          <label>
            Scope
            <select value={tokenScope} onChange={(e) => setTokenScope(e.target.value as "read" | "write")} disabled={minting}>
              <option value="read">Read</option>
              <option value="write">Write</option>
            </select>
          </label>
          <label>
            Name (optional)
            <input type="text" value={tokenName} onChange={(e) => setTokenName(e.target.value)} disabled={minting} placeholder="e.g. ci" />
          </label>
          <button onClick={handleMintToken} disabled={minting}>
            {minting ? "Creating…" : "Create token"}
          </button>
        </div>
        {tokens.length === 0 ? (
          <p className="empty">No tokens yet.</p>
        ) : (
          <table className="instance-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Scope</th>
                <th>Created</th>
                <th>Last used</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td>{t.name ?? <span className="empty">(unnamed)</span>}</td>
                  <td>{t.scope}</td>
                  <td>{new Date(t.createdAt).toLocaleString()}</td>
                  <td>{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "never"}</td>
                  <td>
                    <button className="ghost" onClick={() => handleRevokeToken(t.id)}>
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Activity</h2>
        {auditLog.length === 0 ? (
          <p className="empty">No activity recorded yet.</p>
        ) : (
          <table className="instance-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {auditLog.map((entry, i) => (
                <tr key={i}>
                  <td>{new Date(entry.createdAt).toLocaleString()}</td>
                  <td>{entry.actor}</td>
                  <td>{entry.action}</td>
                  <td className="audit-detail">{entry.detail ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Logs</h2>
        {logsError && !logs ? (
          <p className="empty">Logs unavailable: {logsError}</p>
        ) : (
          <pre className="logs">{logs || "(no logs yet)"}</pre>
        )}
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
