import { Routes, Route, Link } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import InstancePage from "./pages/InstancePage";
import Logo from "./components/Logo";
import ThemeToggle from "./components/ThemeToggle";
import { ToastProvider } from "./components/Toast";
import { ConfirmProvider } from "./components/ConfirmDialog";

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <div className="app">
          <header className="topbar">
            <Link to="/" className="brand">
              <Logo />
              Wharf
            </Link>
            <span className="tagline">where your data docks</span>
            <span className="topbar-spacer" />
            <ThemeToggle />
          </header>
          <main className="content">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/instances/:id" element={<InstancePage />} />
            </Routes>
          </main>
        </div>
      </ConfirmProvider>
    </ToastProvider>
  );
}
