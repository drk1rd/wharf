import { useEffect, useMemo, useState } from "react";
import { api, type OpenRouterModel } from "../lib/api";
import { useAuth } from "../components/AuthProvider";
import { useToast } from "../components/Toast";

export default function Settings() {
  const { user, setUser, authRequired, logout } = useAuth();
  const toast = useToast();
  const [models, setModels] = useState<OpenRouterModel[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(user?.defaultModel ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .listModels()
      .then(setModels)
      .catch((err) => setModelsError(err instanceof Error ? err.message : String(err)));
  }, []);

  const filtered = useMemo(() => {
    if (!models) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => m.id.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q));
  }, [models, filter]);

  async function saveModel() {
    setSaving(true);
    try {
      const updated = await api.updateSettings({ defaultModel: selected });
      setUser(updated);
      toast.push("Default model saved.", "success");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="hero">
        <h1>Settings</h1>
        <p>Your account and how Ask your data picks a model.</p>
      </div>

      {authRequired && user && (
        <section className="panel">
          <h2>Account</h2>
          <dl className="config-list">
            <dt>Email</dt>
            <dd>{user.email}</dd>
          </dl>
          <button className="danger" style={{ marginTop: 16 }} onClick={logout}>
            Sign out
          </button>
        </section>
      )}

      <section className="panel">
        <h2>Ask your data — default model</h2>
        <p className="empty" style={{ marginBottom: 12 }}>
          Picked from whatever OpenRouter's catalog currently offers. Not every model supports the structured query
          generation this feature needs — if one errors, try another.
        </p>
        {modelsError ? (
          <p className="empty">Couldn't load models: {modelsError}. Is <code>OPENROUTER_API_KEY</code> set on the control plane?</p>
        ) : models === null ? (
          <div className="skeleton" style={{ height: 38, borderRadius: "var(--radius-sm)" }} />
        ) : models.length === 0 ? (
          <p className="empty">
            No models available — set <code>OPENROUTER_API_KEY</code> on the control plane to enable Ask your data.
          </p>
        ) : (
          <>
            <input
              type="text"
              className="model-filter"
              placeholder="Filter models…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <select className="model-select" size={8} value={selected} onChange={(e) => setSelected(e.target.value)}>
              {filtered.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                  {m.name && m.name !== m.id ? ` — ${m.name}` : ""}
                </option>
              ))}
            </select>
            <button className="primary" style={{ marginTop: 12 }} onClick={saveModel} disabled={saving || !selected}>
              {saving ? "Saving…" : "Save default model"}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
