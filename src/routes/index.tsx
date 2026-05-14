import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ShieldCheck, Brain, Gauge, Database, Zap } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export const Route = createFileRoute("/")({ component: Landing });

function Landing() {
  const { user } = useAuth();
  return (
    <div className="min-h-screen grid-bg">
      <header className="flex items-center justify-between px-6 md:px-12 py-5 border-b border-border">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <span className="font-bold text-lg tracking-tight">FactoryGuard <span className="text-primary">AI</span></span>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          {user ? (
            <Link to="/dashboard" className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground glow">Open Console</Link>
          ) : (
            <>
              <Link to="/login" className="text-muted-foreground hover:text-foreground">Sign in</Link>
              <Link to="/signup" className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground">Get started</Link>
            </>
          )}
        </nav>
      </header>

      <section className="px-6 md:px-12 py-20 md:py-28 max-w-6xl mx-auto">
        <div className="text-mono text-xs uppercase tracking-[0.3em] text-accent mb-6 pulse-dot">Production-grade · v2.1</div>
        <h1 className="text-5xl md:text-7xl font-bold leading-[1.05] max-w-4xl">
          Predict catastrophic failure
          <span className="block text-primary">24 hours before it happens.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
          IoT predictive maintenance engine for vibration, temperature and pressure sensors. Train on your own dataset, get explainable failure probabilities in real time, and avoid millions in unscheduled downtime.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link to={user ? "/dashboard" : "/signup"} className="rounded-md bg-primary px-6 py-3 font-medium text-primary-foreground glow">
            {user ? "Go to console" : "Launch console →"}
          </Link>
          <a href="#features" className="rounded-md border border-border px-6 py-3 font-medium hover:border-primary">How it works</a>
        </div>

        <div id="features" className="mt-24 grid md:grid-cols-3 gap-4">
          {[
            { icon: Database, t: "Feed your dataset", d: "Upload CSV sensor logs. Auto-detect features and target. Preview rows in seconds." },
            { icon: Brain, t: "Train the model", d: "Logistic regression with class-weight imbalance handling, z-score scaling, train/test split & PR-AUC." },
            { icon: Zap, t: "Real-time inference", d: "Live sensor stream → failure probability under 50ms with SHAP-style feature contributions." },
            { icon: Activity, t: "Explainable alerts", d: "See why a failure was predicted. Per-feature contribution bars, risk levels, recommended actions." },
            { icon: Gauge, t: "Operations console", d: "Live charts, recent predictions log, model lab, dataset registry — one workspace." },
            { icon: ShieldCheck, t: "Per-user secure", d: "Isolated datasets and models per account. Auth, RLS, audit-ready." },
          ].map(({ icon: Icon, t, d }) => (
            <div key={t} className="panel p-6">
              <Icon className="h-6 w-6 text-primary" />
              <h3 className="mt-4 font-semibold">{t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border px-6 md:px-12 py-6 text-xs text-muted-foreground text-mono">
        FACTORYGUARD.AI · CONFIDENTIAL · {new Date().getFullYear()}
      </footer>
    </div>
  );
}
