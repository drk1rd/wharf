import { Routes, Route, Link, useLocation } from "react-router-dom";
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
  const { loading, user } = useAuth();
  const location = useLocation();

  if (loading) return null;
  // No anonymous-access mode anymore — a signed-in user is always required,
  // whether that means signing in, signing up, or (on a fresh instance)
  // completing the mandatory superadmin setup step. AuthPage itself decides
  // which of those to show, based on needsSetup.
  if (!user) return <AuthPage />;

  const onDashboard = location.pathname === "/" || location.pathname.startsWith("/instances/");

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/" className="brand">
          <Logo />
          Wharf
        </Link>
        <nav className="sidebar-nav">
          <Link to="/" className={`sidebar-link ${onDashboard ? "active" : ""}`}>
            Databases
          </Link>
          <Link to="/settings" className={`sidebar-link ${location.pathname === "/settings" ? "active" : ""}`}>
            Settings
          </Link>
        </nav>
        <span className="sidebar-spacer" />
        <div className="sidebar-footer">
          <span className="sidebar-email" title={user.email}>
            {user.email}
          </span>
          <ThemeToggle />
        </div>
      </aside>
      <main className="content">
        <div className="content-inner">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/instances/:id" element={<InstancePage />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </div>
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
