import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/signup")({ component: Signup });

function Signup() {
  const { signUp, user } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (user) nav({ to: "/dashboard" }); }, [user]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return toast.error("Password must be 6+ chars");
    setBusy(true);
    const { error } = await signUp(email, password, name);
    setBusy(false);
    if (error) toast.error(error);
    else { toast.success("Account created — signing you in…"); nav({ to: "/dashboard" }); }
  };

  return (
    <div className="min-h-screen grid-bg flex items-center justify-center p-6">
      <div className="panel p-8 w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 mb-6">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <span className="font-bold">FactoryGuard <span className="text-primary">AI</span></span>
        </Link>
        <h1 className="text-2xl font-semibold">Create operator account</h1>
        <p className="text-sm text-muted-foreground mt-1">Start training models on your sensor data.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Full name" type="text" value={name} onChange={setName} />
          <Field label="Email" type="email" value={email} onChange={setEmail} />
          <Field label="Password" type="password" value={password} onChange={setPassword} />
          <button disabled={busy} className="w-full rounded-md bg-primary px-4 py-2.5 font-medium text-primary-foreground glow disabled:opacity-50">
            {busy ? "Provisioning…" : "Create account"}
          </button>
        </form>
        <p className="mt-6 text-sm text-muted-foreground">Already an operator? <Link to="/login" className="text-accent hover:underline">Sign in</Link></p>
      </div>
    </div>
  );
}

function Field({ label, type, value, onChange }: { label: string; type: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wider text-muted-foreground text-mono">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} required
        className="mt-1 w-full rounded-md bg-input border border-border px-3 py-2 outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
    </label>
  );
}
