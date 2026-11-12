import { useState, type FormEvent } from "react";
import { api } from "../api";
import { Button, Icon } from "../ui";

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.login(password);
      onLoggedIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="brand">
          <div className="brand-mark"><span></span><span></span></div>
          <div><strong>STITCHFLOW</strong><small>TEXTIL OPS</small></div>
        </div>
        <h1>Anmelden</h1>
        <p>Gib das Passwort deiner Werkstatt ein.</p>
        <label className="field-label">
          Passwort
          <input autoComplete="current-password" autoFocus onChange={(e) => setPassword(e.target.value)} required type="password" value={password} />
        </label>
        {error && <p className="login-error"><Icon name="alert" size={15} /> {error}</p>}
        <Button className="primary-button" disabled={busy || !password} type="submit">{busy ? "Prüfe …" : "Anmelden"}</Button>
      </form>
    </div>
  );
}
