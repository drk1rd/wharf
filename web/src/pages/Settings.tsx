import { useEffect, useMemo, useState } from "react";
import { api, type ManagedUser, type OpenRouterModel } from "../lib/api";
import { useAuth } from "../components/AuthProvider";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";

export default function Settings() {
  const { user, setUser, logout } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [models, setModels] = useState<OpenRouterModel[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(user?.defaultModel ?? "");
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<ManagedUser[] | null>(null);

  useEffect(() => {
    if (!user?.isSuperadmin) return;
    api
      .listUsers()
      .then(setUsers)
      .catch((err) => toast.push(err instanceof Error ? err.message : String(err), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.isSuperadmin]);

  async function promote(id: string, isSuperadmin: boolean) {
    try {
      await api.setUserSuperadmin(id, isSuperadmin);
      setUsers(await api.listUsers());
      toast.push(isSuperadmin ? "Promoted to superadmin." : "Superadmin access removed.", "success");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function removeUser(id: string, email: string) {
    const ok = await confirm({
      title: "Delete this account?",
      description: `${email}'s account will be removed. Any databases they own become ownerless (visible to everyone) rather than being deleted.`,
      confirmLabel: "Delete account",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteUser(id);
      setUsers(await api.listUsers());
      toast.push("Account deleted.", "success");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), "error");
    }
  }

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

      {user && (
        <section className="panel">
          <h2>Account</h2>
          <dl className="config-list">
            <dt>Email</dt>
            <dd>{user.email}</dd>
            {user.isSuperadmin && (
              <>
                <dt>Role</dt>
                <dd>Superadmin — full access to every database and every account</dd>
              </>
            )}
          </dl>
          <button className="danger" style={{ marginTop: 16 }} onClick={logout}>
            Sign out
          </button>
        </section>
      )}

      {user?.isSuperadmin && (
        <section className="panel">
          <h2>Users</h2>
          <p className="empty" style={{ marginBottom: 12 }}>
            Every account on this instance. A superadmin can see and manage every database regardless of who
            created it — this is where you grant or remove that access for other accounts.
          </p>
          {users === null ? (
            <div className="skeleton" style={{ height: 80, borderRadius: "var(--radius-sm)" }} />
          ) : (
            <table className="instance-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Databases</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>{u.isSuperadmin ? "Superadmin" : "User"}</td>
                    <td>{u.instanceCount}</td>
                    <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {u.id === user.id ? (
                        <span className="empty">you</span>
                      ) : (
                        <>
                          <button className="ghost" onClick={() => promote(u.id, !u.isSuperadmin)}>
                            {u.isSuperadmin ? "Remove superadmin" : "Make superadmin"}
                          </button>{" "}
                          <button className="danger" onClick={() => removeUser(u.id, u.email)}>
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
