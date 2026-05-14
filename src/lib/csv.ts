import Papa from "papaparse";
import { toast } from "sonner";

export type ParsedDataset = {
  columns: string[];
  numericColumns: string[];
  rows: Record<string, any>[];
  preview: Record<string, any>[];
  rowCount: number;
  stats: Record<string, { mean: number; std: number; min: number; max: number }>;
};

export function parseCsvFile(file: File): Promise<ParsedDataset> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (res) => {
        try {
          const rows = (res.data as Record<string, any>[]).filter(r => r && Object.keys(r).length > 0);
          if (!rows.length) throw new Error("Empty CSV");
          const columns = Object.keys(rows[0]);
          const numericColumns = columns.filter(c => {
            const sample = rows.slice(0, 50).map(r => r[c]).filter(v => v !== null && v !== undefined && v !== "");
            return sample.length > 0 && sample.every(v => typeof v === "number" && !isNaN(v));
          });
          const stats: ParsedDataset["stats"] = {};
          for (const c of numericColumns) {
            const vals = rows.map(r => Number(r[c])).filter(v => !isNaN(v));
            const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
            const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
            stats[c] = { mean, std, min: Math.min(...vals), max: Math.max(...vals) };
          }
          resolve({
            columns, numericColumns, rows,
            preview: rows.slice(0, 8),
            rowCount: rows.length,
            stats,
          });
        } catch (e: any) { reject(e); }
      },
      error: (e) => { toast.error(e.message); reject(e); },
    });
  });
}

export function autoPickTarget(numericColumns: string[]): string | null {
  // Heuristic: prefer a column literally named like a target
  const lower = numericColumns.map(c => c.toLowerCase());
  const candidates = ["machine failure", "failure", "label", "target", "fail", "y"];
  for (const k of candidates) {
    const idx = lower.findIndex(c => c.includes(k));
    if (idx >= 0) return numericColumns[idx];
  }
  return null;
}
