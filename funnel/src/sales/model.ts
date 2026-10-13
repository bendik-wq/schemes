// Small, dependency-free statistics for Funnel HQ: L2 logistic regression by gradient descent,
// AUC, Brier score, reliability by decile, smoothed rates. Pure functions, unit-tested.

export interface Sample { x: number[]; y: 0 | 1 }

export interface LogisticModel {
  features: string[];
  weights: number[];
  bias: number;
}

export const sigmoid = (z: number): number => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));
export const logit = (p: number): number => {
  const q = Math.min(1 - 1e-9, Math.max(1e-9, p));
  return Math.log(q / (1 - q));
};

export function predict(m: Pick<LogisticModel, "weights" | "bias">, x: number[]): number {
  let z = m.bias;
  for (let i = 0; i < m.weights.length; i++) z += m.weights[i] * (x[i] || 0);
  return sigmoid(z);
}

export interface FitOptions {
  /** L2 strength (applied to weights, not the bias). */
  l2?: number;
  /** Learning rate for full-batch gradient descent. */
  lr?: number;
  iterations?: number;
  /** Prior for the bias, e.g. logit of a rules-based base rate. Defaults to the observed rate. */
  biasInit?: number;
  /** Shrink weights towards these instead of zero (a rules prior). */
  priorWeights?: number[];
}

/** Full-batch gradient descent on the mean log-loss + (l2/2n)·‖w − prior‖². Deterministic. */
export function fitLogistic(features: string[], data: Sample[], opts: FitOptions = {}): LogisticModel {
  const d = features.length;
  const n = data.length;
  const l2 = opts.l2 ?? 1;
  const lr = opts.lr ?? 0.5;
  const iters = opts.iterations ?? 800;
  const prior = opts.priorWeights && opts.priorWeights.length === d ? opts.priorWeights : new Array(d).fill(0);
  const w = prior.slice();
  const rate = n ? data.reduce((s, r) => s + r.y, 0) / n : 0.5;
  let b = opts.biasInit ?? logit(Math.min(0.99, Math.max(0.01, rate)));
  if (!n) return { features, weights: w, bias: b };
  const gw = new Array(d).fill(0);
  // A strong penalty on little data makes plain steps overshoot; shrink the step to stay stable.
  const step = lr / (1 + l2 / n);
  for (let it = 0; it < iters; it++) {
    gw.fill(0);
    let gb = 0;
    for (const r of data) {
      const err = predict({ weights: w, bias: b }, r.x) - r.y;
      gb += err;
      for (let j = 0; j < d; j++) if (r.x[j]) gw[j] += err * r.x[j];
    }
    for (let j = 0; j < d; j++) w[j] -= step * (gw[j] / n + (l2 / n) * (w[j] - prior[j]));
    b -= step * (gb / n);
  }
  return { features, weights: w.map((v) => Math.round(v * 1e6) / 1e6), bias: Math.round(b * 1e6) / 1e6 };
}

/** Area under the ROC curve (Mann–Whitney U, ties count half). null when one class is missing. */
export function auc(scores: number[], labels: Array<0 | 1>): number | null {
  const idx = scores.map((s, i) => [s, labels[i]] as const).sort((a, b) => a[0] - b[0]);
  let pos = 0, neg = 0, rankSum = 0;
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (idx[k][1] === 1) { rankSum += avgRank; pos++; } else neg++;
    i = j + 1;
  }
  if (!pos || !neg) return null;
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

export function brier(probs: number[], labels: Array<0 | 1>): number | null {
  if (!probs.length) return null;
  return probs.reduce((s, p, i) => s + (p - labels[i]) ** 2, 0) / probs.length;
}

export interface ReliabilityBin { bin: number; n: number; predicted: number | null; actual: number | null }

/** Sort by predicted probability, cut into `bins` equal-count groups, mean predicted vs observed. */
export function reliability(probs: number[], labels: Array<0 | 1>, bins = 10): ReliabilityBin[] {
  const rows = probs.map((p, i) => ({ p, y: labels[i] })).sort((a, b) => a.p - b.p);
  const out: ReliabilityBin[] = [];
  for (let b = 0; b < bins; b++) {
    const lo = Math.floor((b * rows.length) / bins), hi = Math.floor(((b + 1) * rows.length) / bins);
    const part = rows.slice(lo, hi);
    out.push({
      bin: b + 1, n: part.length,
      predicted: part.length ? round4(part.reduce((s, r) => s + r.p, 0) / part.length) : null,
      actual: part.length ? round4(part.reduce((s, r) => s + r.y, 0) / part.length) : null,
    });
  }
  return out;
}

/** Win rate shrunk towards the base rate: (wins + k·base) / (n + k). */
export function smoothedRate(wins: number, n: number, base: number, k = 5): number {
  return (wins + k * base) / (n + k);
}

export const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Deterministic hold-out split by id (FNV-1a), ~`share` of ids go to the test set. */
export function isHoldout(id: string, share = 0.2): boolean {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h % 1000) / 1000 < share;
}

// ── Robust baselines (alerts) ────────────────────────────────────────────────

export function median(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Robust z: (x − median) / (1.4826 · MAD), with a floor on the scale so flat baselines do not explode. */
export function robustZ(x: number, history: number[], minScale = 1): number | null {
  const med = median(history);
  if (med == null) return null;
  const mad = median(history.map((h) => Math.abs(h - med))) ?? 0;
  const scale = Math.max(minScale, 1.4826 * mad, Math.sqrt(Math.max(med, 0)));
  return (x - med) / scale;
}

/** P(X ≤ k) for X ~ Poisson(λ). */
export function poissonCdf(k: number, lambda: number): number {
  if (lambda <= 0) return 1;
  if (k < 0) return 0;
  let term = Math.exp(-lambda), sum = term;
  for (let i = 1; i <= Math.floor(k); i++) { term *= lambda / i; sum += term; }
  return Math.min(1, sum);
}

/** One-sided 3σ equivalent for a normal tail. */
export const THREE_SIGMA_TAIL = 0.00135;
