import { Routes, Route, Link } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import InstancePage from "./pages/InstancePage";
import Settings from "./pages/Settings";
import AuthPage from "./pages/AuthPage";
import Logo from "./components/Logo";
import ThemeToggle from "./components/ThemeToggle";
import { ToastProvider } from "./components/Toast";
import { ConfirmProvider } from "./components/ConfirmDialog";
import { AuthProvider, useAuth } from "./components/AuthProvider";

function Shell() {
  const { loading, authRequired, user } = useAuth();

  if (loading) return null;
  if (authRequired && !user) return <AuthPage />;

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <Logo />
          Wharf
        </Link>
        <span className="tagline">where your data docks</span>
        <span className="topbar-spacer" />
        {user && <span className="topbar-email">{user.email}</span>}
        <Link to="/settings" className="theme-toggle" title="Settings" aria-label="Settings">
          ⚙
        </Link>
        <ThemeToggle />
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/instances/:id" element={<InstancePage />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
