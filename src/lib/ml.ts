// Pure-JS logistic regression with z-score normalization.
// Trains in-browser, returns weights + metrics.

export type TrainResult = {
  weights: number[];
  intercept: number;
  feature_means: number[];
  feature_stds: number[];
  metrics: {
    accuracy: number;
    precision: number;
    recall: number;
    f1: number;
    pr_auc: number;
    pos_rate: number;
    n_train: number;
    n_test: number;
  };
  log: string[];
};

function sigmoid(z: number) { return 1 / (1 + Math.exp(-Math.max(-50, Math.min(50, z)))); }

export function standardize(X: number[][]) {
  const n = X.length, d = X[0]?.length ?? 0;
  const means = new Array(d).fill(0);
  const stds = new Array(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j++) means[j] += row[j];
  for (let j = 0; j < d; j++) means[j] /= n;
  for (const row of X) for (let j = 0; j < d; j++) stds[j] += (row[j] - means[j]) ** 2;
  for (let j = 0; j < d; j++) stds[j] = Math.sqrt(stds[j] / n) || 1;
  const Z = X.map(r => r.map((v, j) => (v - means[j]) / stds[j]));
  return { Z, means, stds };
}

export function trainLogReg(
  X: number[][],
  y: number[],
  opts: { lr?: number; epochs?: number; l2?: number; classWeight?: boolean } = {},
): TrainResult {
  const lr = opts.lr ?? 0.1;
  const epochs = opts.epochs ?? 200;
  const l2 = opts.l2 ?? 0.001;
  const log: string[] = [];

  // Train/test split (80/20, stratified-ish)
  const idx = X.map((_, i) => i);
  // shuffle
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const split = Math.floor(idx.length * 0.8);
  const trIdx = idx.slice(0, split), teIdx = idx.slice(split);

  const Xtr_raw = trIdx.map(i => X[i]);
  const ytr = trIdx.map(i => y[i]);
  const Xte_raw = teIdx.map(i => X[i]);
  const yte = teIdx.map(i => y[i]);

  const { Z: Xtr, means, stds } = standardize(Xtr_raw);
  const Xte = Xte_raw.map(r => r.map((v, j) => (v - means[j]) / stds[j]));

  const d = Xtr[0]?.length ?? 0;
  const w = new Array(d).fill(0);
  let b = 0;

  // class weights for imbalance
  const pos = ytr.reduce((a, v) => a + v, 0);
  const neg = ytr.length - pos;
  const wPos = opts.classWeight !== false ? ytr.length / (2 * Math.max(1, pos)) : 1;
  const wNeg = opts.classWeight !== false ? ytr.length / (2 * Math.max(1, neg)) : 1;
  log.push(`Train ${ytr.length} | Test ${yte.length} | Pos rate ${(pos / ytr.length * 100).toFixed(2)}%`);
  log.push(`Class weights → pos=${wPos.toFixed(2)} neg=${wNeg.toFixed(2)}`);

  for (let e = 0; e < epochs; e++) {
    const gw = new Array(d).fill(0); let gb = 0;
    let loss = 0;
    for (let i = 0; i < Xtr.length; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * Xtr[i][j];
      const p = sigmoid(z);
      const cw = ytr[i] === 1 ? wPos : wNeg;
      const err = (p - ytr[i]) * cw;
      for (let j = 0; j < d; j++) gw[j] += err * Xtr[i][j];
      gb += err;
      loss += -cw * (ytr[i] * Math.log(p + 1e-9) + (1 - ytr[i]) * Math.log(1 - p + 1e-9));
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / Xtr.length + l2 * w[j]);
    b -= lr * (gb / Xtr.length);
    if (e % Math.max(1, Math.floor(epochs / 6)) === 0 || e === epochs - 1) {
      log.push(`Epoch ${e + 1}/${epochs} — loss ${(loss / Xtr.length).toFixed(4)}`);
    }
  }

  // Eval on test
  const probs = Xte.map(r => {
    let z = b; for (let j = 0; j < d; j++) z += w[j] * r[j]; return sigmoid(z);
  });
  const preds = probs.map(p => (p >= 0.5 ? 1 : 0));
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (let i = 0; i < yte.length; i++) {
    if (preds[i] === 1 && yte[i] === 1) tp++;
    else if (preds[i] === 1 && yte[i] === 0) fp++;
    else if (preds[i] === 0 && yte[i] === 1) fn++;
    else tn++;
  }
  const accuracy = (tp + tn) / Math.max(1, yte.length);
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  const f1 = (2 * precision * recall) / Math.max(1e-9, precision + recall);

  // PR-AUC (trapezoidal across thresholds)
  const sorted = probs.map((p, i) => [p, yte[i]] as [number, number]).sort((a, b) => b[0] - a[0]);
  let cumTP = 0, cumFP = 0;
  const totalPos = yte.reduce((a, v) => a + v, 0);
  const points: Array<[number, number]> = [[0, 1]];
  for (const [, label] of sorted) {
    if (label === 1) cumTP++; else cumFP++;
    const r = cumTP / Math.max(1, totalPos);
    const p = cumTP / Math.max(1, cumTP + cumFP);
    points.push([r, p]);
  }
  let prAuc = 0;
  for (let i = 1; i < points.length; i++) {
    const [r1, p1] = points[i - 1], [r2, p2] = points[i];
    prAuc += (r2 - r1) * (p1 + p2) / 2;
  }

  log.push(`Accuracy ${(accuracy*100).toFixed(2)}% | Precision ${(precision*100).toFixed(1)}% | Recall ${(recall*100).toFixed(1)}% | PR-AUC ${prAuc.toFixed(3)}`);

  return {
    weights: w, intercept: b,
    feature_means: means, feature_stds: stds,
    metrics: { accuracy, precision, recall, f1, pr_auc: prAuc, pos_rate: pos / ytr.length, n_train: ytr.length, n_test: yte.length },
    log,
  };
}

export function predictOne(model: {
  weights: number[]; intercept: number;
  feature_means: number[]; feature_stds: number[];
  feature_columns: string[];
}, sample: Record<string, number>) {
  const x = model.feature_columns.map(c => Number(sample[c] ?? 0));
  const z = x.map((v, j) => (v - model.feature_means[j]) / (model.feature_stds[j] || 1));
  let lin = model.intercept;
  for (let j = 0; j < z.length; j++) lin += model.weights[j] * z[j];
  const prob = 1 / (1 + Math.exp(-Math.max(-50, Math.min(50, lin))));
  // SHAP-like contributions: weight * standardized_value
  const contributions: Record<string, number> = {};
  model.feature_columns.forEach((c, j) => { contributions[c] = model.weights[j] * z[j]; });
  return { probability: prob, contributions };
}

export function riskLevel(p: number): "low" | "medium" | "high" | "critical" {
  if (p >= 0.85) return "critical";
  if (p >= 0.6) return "high";
  if (p >= 0.35) return "medium";
  return "low";
}
