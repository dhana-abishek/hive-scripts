import { useEffect, useMemo, useRef, useState } from "react";
import { ScanLine, X, ChevronRight, Info, Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { parseCSVLine } from "@/lib/csvParser";

const PB_REGEX = /^PB\.\d+$/;

type Step = "sku" | "qty" | "pb";

type Entry = {
  pb: string;
  sku: string;
  qty: number;
};

// Map of sku_id -> array of pickable locations
type PickableMap = Record<string, string[]>;

export function InventoryDiscrepancies() {
  const [step, setStep] = useState<Step>("sku");
  const [skuValue, setSkuValue] = useState("");
  const [qtyValue, setQtyValue] = useState("");
  const [pbValue, setPbValue] = useState("");
  const [currentSku, setCurrentSku] = useState<string | null>(null);
  const [currentQty, setCurrentQty] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [pickableMap, setPickableMap] = useState<PickableMap>({});
  const [csvName, setCsvName] = useState<string | null>(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [step]);

  const resetFlow = () => {
    setCurrentSku(null);
    setCurrentQty(null);
    setSkuValue("");
    setQtyValue("");
    setPbValue("");
    setError(null);
    setStep("sku");
  };

  const handleCsvUpload = async (file: File) => {
    setCsvLoading(true);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
      if (lines.length < 2) {
        setError("CSV is empty.");
        return;
      }
      const headers = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase());
      const skuIdx = headers.indexOf("sku_id");
      const locIdx = headers.indexOf("location");
      const pickIdx = headers.indexOf("pickable_type");
      if (skuIdx < 0 || locIdx < 0 || pickIdx < 0) {
        setError("CSV missing required columns: sku_id, location, pickable_type.");
        return;
      }
      const map: PickableMap = {};
      for (let i = 1; i < lines.length; i++) {
        const fields = parseCSVLine(lines[i]);
        const sku = (fields[skuIdx] ?? "").trim();
        const loc = (fields[locIdx] ?? "").trim();
        const pick = (fields[pickIdx] ?? "").trim().toLowerCase();
        if (!sku || !loc || pick !== "pickable") continue;
        if (!map[sku]) map[sku] = [];
        if (!map[sku].includes(loc)) map[sku].push(loc);
      }
      setPickableMap(map);
      setCsvName(file.name);
      setError(null);
      setInfo(`Loaded ${Object.keys(map).length} SKUs with pickable locations from "${file.name}".`);
    } catch (err) {
      setError(`Failed to parse CSV: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCsvLoading(false);
    }
  };

  const handleSkuSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = skuValue.trim();
    if (!trimmed) return;

    setError(null);
    setInfo(null);
    setCurrentSku(trimmed);
    setSkuValue("");
    setStep("qty");
  };

  const handleQtySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = qtyValue.trim();
    if (!trimmed || !currentSku) return;

    const n = Number(trimmed);
    if (!Number.isInteger(n) || n <= 0) {
      setError(`Invalid quantity: "${trimmed}". Must be a positive whole number.`);
      return;
    }

    // Check if SKU already exists
    const existingIdx = entries.findIndex((e) => e.sku === currentSku);
    if (existingIdx !== -1) {
      const existing = entries[existingIdx];
      setEntries((prev) =>
        prev.map((e, i) => (i === existingIdx ? { ...e, qty: e.qty + n } : e))
      );
      setInfo(
        `SKU "${currentSku}" already in basket ${existing.pb}. Added ${n} (new total: ${existing.qty + n}).`
      );
      resetFlow();
      return;
    }

    setError(null);
    setCurrentQty(n);
    setQtyValue("");
    setStep("pb");
  };

  const handlePbSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = pbValue.trim();
    if (!trimmed || !currentSku || currentQty == null) return;

    if (!PB_REGEX.test(trimmed)) {
      setError(`Invalid PB format: "${trimmed}". Expected like "PB.1", "PB.42", "PB.100".`);
      return;
    }

    if (entries.some((e) => e.pb === trimmed)) {
      setError(`PB "${trimmed}" has already been used. Scan a different basket.`);
      return;
    }

    setEntries((prev) => [{ pb: trimmed, sku: currentSku, qty: currentQty }, ...prev]);
    setInfo(null);
    resetFlow();
  };

  const removeAt = (idx: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== idx));
  };

  const heading =
    step === "sku" ? "Scan SKU ID" : step === "qty" ? "Enter Quantity" : "Scan PB Number";

  const hasMap = useMemo(() => Object.keys(pickableMap).length > 0, [pickableMap]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleCsvUpload(f);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={csvLoading}
        >
          <Upload size={14} className="mr-1.5" />
          {csvLoading ? "Loading..." : "Upload Inventory CSV"}
        </Button>
        {csvName && (
          <span className="text-xs text-muted-foreground truncate">
            {csvName} · {Object.keys(pickableMap).length} SKUs
          </span>
        )}
      </div>

      <div className="rounded-md border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ScanLine size={18} className="text-muted-foreground" />
          <h3 className="text-sm font-medium">{heading}</h3>
          {currentSku && (
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
              <span className="font-mono px-2 py-0.5 rounded bg-secondary">{currentSku}</span>
              <ChevronRight size={12} />
              {currentQty != null ? (
                <>
                  <span className="font-mono px-2 py-0.5 rounded bg-secondary">Qty {currentQty}</span>
                  <ChevronRight size={12} />
                  <span>PB</span>
                </>
              ) : (
                <span>Qty</span>
              )}
            </span>
          )}
        </div>

        {step === "sku" && (
          <form onSubmit={handleSkuSubmit} className="flex gap-2">
            <Input
              ref={inputRef}
              value={skuValue}
              onChange={(e) => {
                setSkuValue(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Scan SKU ID"
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" size="sm">Next</Button>
          </form>
        )}

        {step === "qty" && (
          <form onSubmit={handleQtySubmit} className="flex gap-2">
            <Input
              ref={inputRef}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={qtyValue}
              onChange={(e) => {
                setQtyValue(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Enter quantity"
              autoComplete="off"
              className={error ? "border-destructive focus-visible:ring-destructive" : ""}
            />
            <Button type="submit" size="sm">Next</Button>
            <Button type="button" size="sm" variant="ghost" onClick={resetFlow}>
              Cancel
            </Button>
          </form>
        )}

        {step === "pb" && (
          <form onSubmit={handlePbSubmit} className="flex gap-2">
            <Input
              ref={inputRef}
              value={pbValue}
              onChange={(e) => {
                setPbValue(e.target.value);
                if (error) setError(null);
              }}
              placeholder="e.g. PB.1, PB.42, PB.100"
              autoComplete="off"
              spellCheck={false}
              className={error ? "border-destructive focus-visible:ring-destructive" : ""}
            />
            <Button type="submit" size="sm">Add</Button>
            <Button type="button" size="sm" variant="ghost" onClick={resetFlow}>
              Cancel
            </Button>
          </form>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
        {info && (
          <p className="text-xs flex items-start gap-1 text-foreground">
            <Info size={12} className="mt-0.5 shrink-0" />
            <span>{info}</span>
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {step === "sku" && <>Scan the SKU ID to begin.</>}
          {step === "qty" && <>Enter quantity for <span className="font-mono">{currentSku}</span>.</>}
          {step === "pb" && (
            <>New SKU — scan the PB number where <span className="font-mono">{currentSku}</span> (qty {currentQty}) is located. Format: <code className="px-1 py-0.5 rounded bg-secondary">PB.</code> followed by a number.</>
          )}
        </p>
      </div>

      {entries.length > 0 && (
        <div className="rounded-md border border-border bg-card">
          <div className="px-4 py-2 border-b border-border text-xs font-medium text-muted-foreground grid grid-cols-[1.2fr_0.8fr_auto_2fr_auto] gap-4">
            <span>SKU</span>
            <span>PB</span>
            <span>Qty</span>
            <span>Pickable Location{hasMap ? "" : " (upload CSV)"}</span>
            <span className="sr-only">Actions</span>
          </div>
          <ul className="divide-y divide-border">
            {entries.map((entry, i) => {
              const locs = pickableMap[entry.sku];
              return (
                <li
                  key={`${entry.sku}-${i}`}
                  className="grid grid-cols-[1.2fr_0.8fr_auto_2fr_auto] gap-4 items-center px-4 py-2 text-sm"
                >
                  <span className="font-mono truncate">{entry.sku}</span>
                  <span className="font-mono">{entry.pb}</span>
                  <span className="font-mono tabular-nums text-right">{entry.qty}</span>
                  <span className="font-mono text-xs truncate text-muted-foreground" title={locs?.join(", ")}>
                    {!hasMap ? "—" : locs && locs.length > 0 ? locs.join(", ") : "Not pickable / not found"}
                  </span>
                  <button
                    onClick={() => removeAt(i)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${entry.sku}`}
                  >
                    <X size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
