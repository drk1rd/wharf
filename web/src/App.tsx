import { Routes, Route, Link } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import InstancePage from "./pages/InstancePage";

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          Wharf
        </Link>
        <span className="tagline">where your data docks</span>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/instances/:id" element={<InstancePage />} />
        </Routes>
      </main>
    </div>
  );
}
