import { useState } from "react";
import { supabase } from "../../services/supabase.js";

export default function Login({ onSwitch }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!supabase) { setStatus("Supabase auth is not configured yet."); return; }
    setLoading(true);
    setStatus("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setStatus(error.message);
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        placeholder="Email address"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoComplete="email"
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        autoComplete="current-password"
      />
      <button className="send-button" type="submit" disabled={loading} style={{ width: "100%", marginBottom: "12px" }}>
        {loading ? "Signing in..." : "Sign In"}
      </button>
      {status && <p className="status-row" style={{ color: status.includes("success") ? "var(--success)" : "var(--danger)" }}>{status}</p>}
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: "12px 0 0", textAlign: "center" }}>
        Don't have an account?{" "}
        <button className="pill-button" type="button" onClick={onSwitch} style={{ padding: "4px 10px", fontSize: "0.88rem" }}>
          Create account
        </button>
      </p>
    </form>
  );
}