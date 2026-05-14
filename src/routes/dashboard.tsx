import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { parseCsvFile, autoPickTarget, type ParsedDataset } from "@/lib/csv";
import { trainLogReg, predictOne, riskLevel } from "@/lib/ml";
import { toast } from "sonner";
import {
  Activity, Database, Brain, ShieldCheck, LogOut, Upload, Play, Trash2,
  Gauge, Thermometer, Zap, AlertTriangle, CheckCircle2, Cpu, Layers, FileSpreadsheet,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, ReferenceLine, Cell,
} from "recharts";
import { motion, AnimatePresence } from "motion/react";

export const Route = createFileRoute("/dashboard")({ component: Dashboard });

type Tab = "console" | "datasets" | "train" | "predictions";

type DatasetRow = {
  id: string; name: string; description: string | null; columns: string[];
  feature_columns: string[]; target_column: string | null; row_count: number;
  sample_rows: Record<string, any>[]; stats: Record<string, any>; created_at: string;
};
type ModelRow = {
  id: string; name: string; algorithm: string; status: string;
  weights: number[]; intercept: number; feature_columns: string[];
  feature_means: number[]; feature_stds: number[]; threshold: number;
  metrics: any; training_log: string | null; is_active: boolean;
  trained_at: string | null; created_at: string; dataset_id: string | null;
};

function Dashboard() {
  const { user, loading, signOut } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("console");
  const [datasets, setDatasets] = useState<DatasetRow[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [predictions, setPredictions] = useState<any[]>([]);
  const [activeModel, setActiveModel] = useState<ModelRow | null>(null);

  useEffect(() => { if (!loading && !user) nav({ to: "/login" }); }, [user, loading]);

  const refresh = async () => {
    const [d, m, p] = await Promise.all([
      supabase.from("datasets").select("*").order("created_at", { ascending: false }),
      supabase.from("models").select("*").order("created_at", { ascending: false }),
      supabase.from("predictions").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    if (d.data) setDatasets(d.data as any);
    if (m.data) {
      setModels(m.data as any);
      const active = (m.data as any[]).find(x => x.is_active) ?? (m.data as any[]).find(x => x.status === "trained");
      if (active) setActiveModel(active);
    }
    if (p.data) setPredictions(p.data);
  };

  useEffect(() => { if (user) refresh(); }, [user]);

  // realtime predictions
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel("preds")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "predictions", filter: `user_id=eq.${user.id}` },
        (payload) => setPredictions(prev => [payload.new, ...prev].slice(0, 50)))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  if (loading || !user) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Authenticating…</div>;

  return (
    <div className="min-h-screen grid-bg">
      <header className="flex items-center justify-between px-4 md:px-8 py-4 border-b border-border bg-background/70 backdrop-blur sticky top-0 z-30">
        <Link to="/" className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <span className="font-bold tracking-tight">FactoryGuard <span className="text-primary">AI</span></span>
        </Link>
        <nav className="hidden md:flex gap-1 panel p-1">
          {([
            ["console", "Live console", Activity],
            ["datasets", "Datasets", Database],
            ["train", "Model lab", Brain],
            ["predictions", "Predictions", Layers],
          ] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition ${tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <span className="hidden sm:block text-xs text-muted-foreground text-mono">{user.email}</span>
          <button onClick={async () => { await signOut(); nav({ to: "/" }); }} className="rounded-md border border-border p-2 hover:border-primary" title="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="md:hidden flex gap-1 p-2 overflow-x-auto">
        {(["console","datasets","train","predictions"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-md text-xs whitespace-nowrap ${tab===t?"bg-primary text-primary-foreground":"bg-muted text-muted-foreground"}`}>{t}</button>
        ))}
      </div>

      <main className="px-4 md:px-8 py-6 max-w-[1400px] mx-auto">
        {tab === "console" && <Console activeModel={activeModel} predictions={predictions} models={models} />}
        {tab === "datasets" && <Datasets datasets={datasets} refresh={refresh} userId={user.id} />}
        {tab === "train" && <Train datasets={datasets} models={models} refresh={refresh} userId={user.id} />}
        {tab === "predictions" && <PredictionsLog predictions={predictions} />}
      </main>
    </div>
  );
}

/* ---------------- LIVE CONSOLE ---------------- */
function Console({ activeModel, predictions, models }: { activeModel: ModelRow | null; predictions: any[]; models: ModelRow[] }) {
  const [auto, setAuto] = useState(true);
  const [stream, setStream] = useState<Array<{ t: string; vibration: number; temperature: number; pressure: number; prob: number }>>([]);
  const [current, setCurrent] = useState<{ prob: number; contrib: Record<string, number>; sensors: any } | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState({ vibration: 0.5, temperature: 65, pressure: 1.0, robot_id: "robot-001" });

  // Pick which features the model uses (auto-map by name fallback)
  const featureMap = useMemo(() => {
    if (!activeModel) return null;
    const map: Record<string, string> = {};
    activeModel.feature_columns.forEach(c => {
      const lc = c.toLowerCase();
      if (lc.includes("vib") || lc.includes("rotational") || lc.includes("speed")) map[c] = "vibration";
      else if (lc.includes("temp")) map[c] = "temperature";
      else if (lc.includes("press") || lc.includes("torque")) map[c] = "pressure";
      else map[c] = c;
    });
    return map;
  }, [activeModel]);

  const runPrediction = async (sensors: { vibration: number; temperature: number; pressure: number; robot_id: string }) => {
    if (!activeModel || !featureMap) {
      toast.error("Train and activate a model first.");
      return;
    }
    setBusy(true);
    try {
      // Build input by mapping model features → simulated sensor (or use stat means as fallback)
      const input: Record<string, number> = {};
      activeModel.feature_columns.forEach((c, j) => {
        const slot = featureMap[c];
        if (slot === "vibration") input[c] = scaleTo(sensors.vibration, activeModel.feature_means[j], activeModel.feature_stds[j], 0, 1);
        else if (slot === "temperature") input[c] = scaleTo(sensors.temperature, activeModel.feature_means[j], activeModel.feature_stds[j], 25, 110);
        else if (slot === "pressure") input[c] = scaleTo(sensors.pressure, activeModel.feature_means[j], activeModel.feature_stds[j], 0.5, 2.0);
        else input[c] = activeModel.feature_means[j];
      });
      const { probability, contributions } = predictOne({
        weights: activeModel.weights, intercept: activeModel.intercept,
        feature_means: activeModel.feature_means, feature_stds: activeModel.feature_stds,
        feature_columns: activeModel.feature_columns,
      }, input);
      setCurrent({ prob: probability, contrib: contributions, sensors });
      setStream(s => [...s.slice(-39), { t: new Date().toLocaleTimeString(), vibration: sensors.vibration, temperature: sensors.temperature, pressure: sensors.pressure, prob: probability }]);
      // persist
      await supabase.from("predictions").insert({
        user_id: (await supabase.auth.getUser()).data.user!.id,
        model_id: activeModel.id,
        robot_id: sensors.robot_id,
        sensors,
        probability,
        risk_level: riskLevel(probability),
        shap_values: contributions,
      });
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  // simulator
  useEffect(() => {
    if (!auto || !activeModel) return;
    const id = setInterval(() => {
      // semi-realistic drift
      const baseV = 0.4 + Math.random() * 0.4;
      const baseT = 60 + Math.random() * 25;
      const baseP = 0.9 + Math.random() * 0.3;
      // occasional anomaly spike
      const spike = Math.random() < 0.15;
      runPrediction({
        vibration: baseV + (spike ? Math.random() * 0.4 : 0),
        temperature: baseT + (spike ? Math.random() * 25 : 0),
        pressure: baseP + (spike ? Math.random() * 0.6 : 0),
        robot_id: `robot-00${1 + Math.floor(Math.random() * 4)}`,
      });
    }, 2200);
    return () => clearInterval(id);
  }, [auto, activeModel]);

  if (!activeModel) {
    return (
      <div className="panel p-12 text-center">
        <Cpu className="h-12 w-12 text-primary mx-auto" />
        <h2 className="mt-4 text-2xl font-semibold">No active model</h2>
        <p className="mt-2 text-muted-foreground">Upload a dataset and train a model to start streaming predictions.</p>
        <div className="mt-6 flex gap-3 justify-center">
          <Link to="/dashboard" search={{}} onClick={() => {}}><span /></Link>
        </div>
      </div>
    );
  }

  const risk = current ? riskLevel(current.prob) : "low";
  const riskColor = { low: "text-success", medium: "text-warning", high: "text-destructive", critical: "text-destructive" }[risk];
  const contribData = current
    ? Object.entries(current.contrib).map(([k, v]) => ({ feature: k.length > 18 ? k.slice(0, 16) + "…" : k, value: Number(v.toFixed(3)) }))
    : [];

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      {/* Left: live charts */}
      <div className="lg:col-span-2 space-y-4">
        <div className="panel p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold flex items-center gap-2"><Activity className="h-4 w-4 text-primary" />Sensor stream</h2>
              <p className="text-xs text-muted-foreground text-mono mt-1">Model: {activeModel.name} · {models.length} model(s)</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setAuto(a => !a)} className={`text-xs px-3 py-1.5 rounded-md ${auto ? "bg-success/20 text-success" : "bg-muted text-muted-foreground"}`}>
                {auto ? "● Streaming" : "○ Paused"}
              </button>
              <button disabled={busy} onClick={() => runPrediction({ vibration: manual.vibration, temperature: manual.temperature, pressure: manual.pressure, robot_id: manual.robot_id })}
                className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground">Run once</button>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stream}>
                <CartesianGrid stroke="oklch(0.3 0.02 240)" strokeDasharray="3 3" />
                <XAxis dataKey="t" stroke="oklch(0.6 0.02 240)" fontSize={10} />
                <YAxis yAxisId="l" stroke="oklch(0.6 0.02 240)" fontSize={10} />
                <YAxis yAxisId="r" orientation="right" stroke="oklch(0.78 0.17 65)" fontSize={10} domain={[0, 1]} />
                <Tooltip contentStyle={{ background: "oklch(0.18 0.018 240)", border: "1px solid oklch(0.3 0.02 240)", borderRadius: 8, fontSize: 12 }} />
                <Line yAxisId="l" type="monotone" dataKey="temperature" stroke="oklch(0.62 0.22 25)" dot={false} strokeWidth={2} />
                <Line yAxisId="l" type="monotone" dataKey="pressure" stroke="oklch(0.72 0.15 200)" dot={false} strokeWidth={2} />
                <Line yAxisId="l" type="monotone" dataKey="vibration" stroke="oklch(0.65 0.20 300)" dot={false} strokeWidth={2} />
                <Line yAxisId="r" type="monotone" dataKey="prob" stroke="oklch(0.78 0.17 65)" dot={false} strokeWidth={2.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Brain className="h-4 w-4 text-accent" />Feature contributions (SHAP-like)</h3>
          <div className="h-56">
            {contribData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Run a prediction to see contributions.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={contribData} layout="vertical" margin={{ left: 30 }}>
                  <CartesianGrid stroke="oklch(0.3 0.02 240)" strokeDasharray="3 3" />
                  <XAxis type="number" stroke="oklch(0.6 0.02 240)" fontSize={10} />
                  <YAxis type="category" dataKey="feature" stroke="oklch(0.6 0.02 240)" fontSize={11} width={120} />
                  <Tooltip contentStyle={{ background: "oklch(0.18 0.018 240)", border: "1px solid oklch(0.3 0.02 240)", borderRadius: 8, fontSize: 12 }} />
                  <ReferenceLine x={0} stroke="oklch(0.6 0.02 240)" />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {contribData.map((d, i) => <Cell key={i} fill={d.value >= 0 ? "oklch(0.62 0.22 25)" : "oklch(0.72 0.16 150)"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Manual input */}
        <div className="panel p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Play className="h-4 w-4 text-primary" />Manual sensor input</h3>
          <div className="grid sm:grid-cols-4 gap-3">
            {([
              ["vibration", "Vibration (g)", 0, 1.5, 0.05, Activity],
              ["temperature", "Temperature (°C)", 20, 120, 1, Thermometer],
              ["pressure", "Pressure (bar)", 0, 3, 0.05, Gauge],
            ] as const).map(([k, lbl, mn, mx, st, Icon]) => (
              <label key={k} className="block">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground text-mono flex items-center gap-1"><Icon className="h-3 w-3" />{lbl}</span>
                <input type="range" min={mn} max={mx} step={st} value={manual[k]} onChange={e => setManual(m => ({ ...m, [k]: Number(e.target.value) }))} className="w-full mt-2 accent-primary" />
                <span className="text-mono text-sm text-primary">{manual[k].toFixed(2)}</span>
              </label>
            ))}
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground text-mono">Robot ID</span>
              <input value={manual.robot_id} onChange={e => setManual(m => ({ ...m, robot_id: e.target.value }))} className="w-full mt-2 rounded-md bg-input border border-border px-2 py-1 text-sm" />
            </label>
          </div>
        </div>
      </div>

      {/* Right: status panel */}
      <div className="space-y-4">
        <div className="panel p-5">
          <span className="text-xs uppercase tracking-wider text-muted-foreground text-mono">Failure probability</span>
          <div className="mt-2 flex items-baseline gap-3">
            <span className={`text-6xl font-bold text-mono ${riskColor}`}>{current ? Math.round(current.prob * 100) : "—"}</span>
            <span className="text-2xl text-muted-foreground">%</span>
          </div>
          <div className={`mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-md text-xs font-medium uppercase text-mono ${
            risk === "critical" || risk === "high" ? "bg-destructive/20 text-destructive" :
            risk === "medium" ? "bg-warning/20 text-warning" : "bg-success/20 text-success"
          }`}>
            {risk === "low" ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            {risk} risk
          </div>
          <div className="mt-4 h-2 bg-muted rounded-full overflow-hidden">
            <motion.div initial={{ width: 0 }} animate={{ width: `${(current?.prob ?? 0) * 100}%` }}
              className={`h-full ${risk === "critical" || risk === "high" ? "bg-destructive" : risk === "medium" ? "bg-warning" : "bg-success"}`} />
          </div>
        </div>

        <div className="panel p-5">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><Layers className="h-4 w-4 text-accent" />Recent predictions</h3>
          <ul className="space-y-2 max-h-80 overflow-y-auto">
            <AnimatePresence initial={false}>
              {predictions.slice(0, 12).map(p => (
                <motion.li key={p.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                  className="flex items-center justify-between text-xs panel p-2.5">
                  <div>
                    <div className="font-medium text-mono">{p.robot_id}</div>
                    <div className="text-muted-foreground">{new Date(p.created_at).toLocaleTimeString()}</div>
                  </div>
                  <div className={`text-mono font-semibold ${
                    p.risk_level === "critical" || p.risk_level === "high" ? "text-destructive" :
                    p.risk_level === "medium" ? "text-warning" : "text-success"}`}>
                    {(p.probability * 100).toFixed(1)}%
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
            {predictions.length === 0 && <li className="text-xs text-muted-foreground">No predictions yet.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}

function scaleTo(slider: number, mean: number, std: number, sliderMin: number, sliderMax: number) {
  // Map slider to a value distribution roughly centered at the model's feature mean ± 2 std.
  const norm = (slider - sliderMin) / (sliderMax - sliderMin); // 0..1
  return mean + (norm - 0.5) * 4 * std;
}

/* ---------------- DATASETS ---------------- */
function Datasets({ datasets, refresh, userId }: { datasets: DatasetRow[]; refresh: () => void; userId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState<ParsedDataset | null>(null);
  const [name, setName] = useState("");
  const [target, setTarget] = useState<string>("");
  const [features, setFeatures] = useState<string[]>([]);

  const onFile = async (f: File) => {
    setBusy(true);
    try {
      const p = await parseCsvFile(f);
      setParsed(p); setName(f.name.replace(/\.csv$/i, ""));
      const t = autoPickTarget(p.numericColumns);
      setTarget(t ?? "");
      setFeatures(p.numericColumns.filter(c => c !== t).slice(0, 8));
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (!parsed || !name || !target || features.length === 0) return toast.error("Pick name, target, and at least one feature.");
    setBusy(true);
    // Persist up to 5000 rows so training has data to work with (sample_rows = jsonb).
    const trainingRows = parsed.rows.slice(0, 5000).map(r => {
      const slim: Record<string, any> = {};
      [...features, target].forEach(c => { slim[c] = r[c]; });
      return slim;
    });
    const { error } = await supabase.from("datasets").insert({
      user_id: userId, name, columns: parsed.columns,
      feature_columns: features, target_column: target,
      row_count: parsed.rowCount, sample_rows: trainingRows,
      stats: parsed.stats,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Dataset saved");
    setParsed(null); setName(""); setTarget(""); setFeatures([]);
    refresh();
  };

  const del = async (id: string) => {
    await supabase.from("datasets").delete().eq("id", id);
    refresh();
  };

  return (
    <div className="space-y-4">
      <div className="panel p-6">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2"><Database className="h-5 w-5 text-primary" />Feed the dataset</h2>
            <p className="text-sm text-muted-foreground mt-1">Upload a CSV with sensor readings + a binary failure column. We auto-detect numeric features.</p>
          </div>
          <input ref={inputRef} type="file" accept=".csv" hidden onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
          <button onClick={() => inputRef.current?.click()} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground glow flex items-center gap-2">
            <Upload className="h-4 w-4" />Upload CSV
          </button>
        </div>

        {parsed && (
          <div className="space-y-4 mt-4">
            <div className="grid md:grid-cols-3 gap-3">
              <Stat label="Rows" value={parsed.rowCount.toLocaleString()} />
              <Stat label="Columns" value={parsed.columns.length} />
              <Stat label="Numeric features" value={parsed.numericColumns.length} />
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs uppercase tracking-wider text-muted-foreground text-mono">Dataset name</span>
                <input value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full rounded-md bg-input border border-border px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="text-xs uppercase tracking-wider text-muted-foreground text-mono">Target column (binary 0/1)</span>
                <select value={target} onChange={e => setTarget(e.target.value)} className="mt-1 w-full rounded-md bg-input border border-border px-3 py-2 text-sm">
                  <option value="">— select —</option>
                  {parsed.numericColumns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            </div>
            <div>
              <span className="text-xs uppercase tracking-wider text-muted-foreground text-mono">Feature columns ({features.length})</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {parsed.numericColumns.filter(c => c !== target).map(c => {
                  const on = features.includes(c);
                  return (
                    <button key={c} onClick={() => setFeatures(f => on ? f.filter(x => x !== c) : [...f, c])}
                      className={`text-xs px-2.5 py-1 rounded-md border ${on ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary"}`}>
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="overflow-x-auto panel p-2">
              <table className="text-xs w-full">
                <thead><tr>{parsed.columns.map(c => <th key={c} className="px-2 py-1 text-left text-muted-foreground text-mono">{c}</th>)}</tr></thead>
                <tbody>
                  {parsed.preview.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      {parsed.columns.map(c => <td key={c} className="px-2 py-1 text-mono">{String(r[c])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <button disabled={busy} onClick={save} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Save dataset</button>
              <button onClick={() => setParsed(null)} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div className="panel p-6">
        <h3 className="font-semibold flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-accent" />Saved datasets</h3>
        <div className="mt-4 grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {datasets.length === 0 && <p className="text-sm text-muted-foreground">No datasets yet.</p>}
          {datasets.map(d => (
            <div key={d.id} className="panel p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-medium">{d.name}</h4>
                  <p className="text-xs text-muted-foreground text-mono mt-1">{d.row_count.toLocaleString()} rows · {d.feature_columns.length} features</p>
                  <p className="text-xs text-muted-foreground mt-1">target: <span className="text-accent text-mono">{d.target_column}</span></p>
                </div>
                <button onClick={() => del(d.id)} className="text-muted-foreground hover:text-destructive p-1"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="panel p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground text-mono">{label}</div>
      <div className="text-2xl font-bold text-primary text-mono">{value}</div>
    </div>
  );
}

/* ---------------- TRAIN MODEL ---------------- */
function Train({ datasets, models, refresh, userId }: { datasets: DatasetRow[]; models: ModelRow[]; refresh: () => void; userId: string }) {
  const [selected, setSelected] = useState<string>("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [result, setResult] = useState<any | null>(null);

  const ds = datasets.find(d => d.id === selected);

  // Re-fetch full dataset rows from sample (we only stored preview). For large datasets, retrain only on sample.
  // To support real training we re-parse from a stored CSV — simpler: train on what user uploads now.
  // For convenience we ALSO support training directly from a freshly uploaded CSV via the "Datasets" tab,
  // but rows aren't persisted server-side. So Train uses sample_rows if ≥100 rows; otherwise prompts re-upload.

  const train = async () => {
    if (!ds) return toast.error("Pick a dataset");
    if (!name) return toast.error("Name your model");
    const rows = ds.sample_rows;
    if (!rows || rows.length < 20) return toast.error("Sample too small. Re-upload a larger CSV (we'll persist all rows in this version).");
    setBusy(true); setProgress([]); setResult(null);
    try {
      const X = rows.map(r => ds.feature_columns.map(c => Number(r[c]) || 0));
      const y = rows.map(r => Number(r[ds.target_column!]) ? 1 : 0);
      setProgress(p => [...p, `Loaded ${rows.length} rows × ${ds.feature_columns.length} features`]);
      await new Promise(r => setTimeout(r, 200));
      const out = trainLogReg(X, y, { epochs: 250, lr: 0.1, classWeight: true });
      setProgress(p => [...p, ...out.log]);
      // Save model — and mark active (deactivate others)
      await supabase.from("models").update({ is_active: false }).eq("user_id", userId);
      const { error } = await supabase.from("models").insert({
        user_id: userId, dataset_id: ds.id, name,
        algorithm: "logistic_regression",
        status: "trained", weights: out.weights, intercept: out.intercept,
        feature_columns: ds.feature_columns,
        feature_means: out.feature_means, feature_stds: out.feature_stds,
        threshold: 0.5, metrics: out.metrics,
        training_log: out.log.join("\n"),
        is_active: true, trained_at: new Date().toISOString(),
      });
      if (error) throw error;
      setResult(out);
      toast.success("Model trained & activated");
      refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const activate = async (id: string) => {
    await supabase.from("models").update({ is_active: false }).eq("user_id", userId);
    await supabase.from("models").update({ is_active: true }).eq("id", id);
    toast.success("Model activated");
    refresh();
  };
  const del = async (id: string) => { await supabase.from("models").delete().eq("id", id); refresh(); };

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 panel p-6">
        <h2 className="text-xl font-semibold flex items-center gap-2"><Brain className="h-5 w-5 text-primary" />Train the model</h2>
        <p className="text-sm text-muted-foreground mt-1">Logistic regression with z-score scaling and class-weight balancing for rare-event detection.</p>
        <div className="mt-4 grid md:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-muted-foreground text-mono">Dataset</span>
            <select value={selected} onChange={e => setSelected(e.target.value)} className="mt-1 w-full rounded-md bg-input border border-border px-3 py-2 text-sm">
              <option value="">— select —</option>
              {datasets.map(d => <option key={d.id} value={d.id}>{d.name} ({d.row_count} rows)</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-muted-foreground text-mono">Model name</span>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. xgb-v1" className="mt-1 w-full rounded-md bg-input border border-border px-3 py-2 text-sm" />
          </label>
        </div>
        {ds && (
          <div className="mt-3 text-xs text-muted-foreground text-mono">
            features: <span className="text-accent">{ds.feature_columns.join(", ")}</span> · target: <span className="text-primary">{ds.target_column}</span>
          </div>
        )}
        <button disabled={busy || !selected || !name} onClick={train}
          className="mt-5 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground glow disabled:opacity-50 flex items-center gap-2">
          <Play className="h-4 w-4" />{busy ? "Training…" : "Start training"}
        </button>

        {progress.length > 0 && (
          <div className="mt-5 panel p-4 max-h-64 overflow-auto">
            <h4 className="text-xs uppercase tracking-wider text-muted-foreground text-mono mb-2">Training log</h4>
            <pre className="text-xs text-mono leading-relaxed whitespace-pre-wrap">{progress.join("\n")}</pre>
          </div>
        )}

        {result && (
          <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric label="Accuracy" value={`${(result.metrics.accuracy * 100).toFixed(1)}%`} />
            <Metric label="Precision" value={`${(result.metrics.precision * 100).toFixed(1)}%`} />
            <Metric label="Recall" value={`${(result.metrics.recall * 100).toFixed(1)}%`} />
            <Metric label="PR-AUC" value={result.metrics.pr_auc.toFixed(3)} highlight />
          </div>
        )}
      </div>

      <div className="panel p-6">
        <h3 className="font-semibold flex items-center gap-2"><Layers className="h-4 w-4 text-accent" />Trained models</h3>
        <ul className="mt-4 space-y-3">
          {models.length === 0 && <li className="text-sm text-muted-foreground">No models yet.</li>}
          {models.map(m => (
            <li key={m.id} className="panel p-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium flex items-center gap-2">
                    {m.name}
                    {m.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/20 text-success uppercase">Active</span>}
                  </div>
                  <div className="text-xs text-muted-foreground text-mono mt-1">
                    PR-AUC {Number(m.metrics?.pr_auc ?? 0).toFixed(3)} · {m.feature_columns.length} feats
                  </div>
                </div>
                <div className="flex gap-1">
                  {!m.is_active && <button onClick={() => activate(m.id)} className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground">Use</button>}
                  <button onClick={() => del(m.id)} className="text-muted-foreground hover:text-destructive p-1"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="panel p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground text-mono">{label}</div>
      <div className={`text-2xl font-bold text-mono ${highlight ? "text-primary" : "text-foreground"}`}>{value}</div>
    </div>
  );
}

/* ---------------- PREDICTIONS LOG ---------------- */
function PredictionsLog({ predictions }: { predictions: any[] }) {
  return (
    <div className="panel p-6">
      <h2 className="text-xl font-semibold flex items-center gap-2"><Layers className="h-5 w-5 text-primary" />Predictions log</h2>
      <p className="text-sm text-muted-foreground mt-1">Live-updates as your active model classifies new readings.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase text-muted-foreground text-mono">
            <th className="py-2">Time</th><th>Robot</th><th>Probability</th><th>Risk</th><th>Sensors</th>
          </tr></thead>
          <tbody>
            {predictions.map(p => (
              <tr key={p.id} className="border-t border-border">
                <td className="py-2 text-mono text-xs">{new Date(p.created_at).toLocaleString()}</td>
                <td className="text-mono">{p.robot_id}</td>
                <td className="text-mono font-semibold">{(p.probability * 100).toFixed(2)}%</td>
                <td><span className={`text-xs px-2 py-0.5 rounded uppercase text-mono ${
                  p.risk_level === "critical" || p.risk_level === "high" ? "bg-destructive/20 text-destructive" :
                  p.risk_level === "medium" ? "bg-warning/20 text-warning" : "bg-success/20 text-success"
                }`}>{p.risk_level}</span></td>
                <td className="text-xs text-muted-foreground text-mono">
                  v={p.sensors?.vibration?.toFixed?.(2)} t={p.sensors?.temperature?.toFixed?.(1)} p={p.sensors?.pressure?.toFixed?.(2)}
                </td>
              </tr>
            ))}
            {predictions.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No predictions yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
