import { useEffect, useRef, useState } from "react";
import { ScanLine, X, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const PB_REGEX = /^PB\.\d+$/;

type Step = "pb" | "sku" | "qty";

type Entry = {
  pb: string;
  sku: string;
  qty: number;
};

export function InventoryDiscrepancies() {
  const [step, setStep] = useState<Step>("pb");
  const [pbValue, setPbValue] = useState("");
  const [skuValue, setSkuValue] = useState("");
  const [qtyValue, setQtyValue] = useState("");
  const [currentPb, setCurrentPb] = useState<string | null>(null);
  const [currentSku, setCurrentSku] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [step]);

  const resetFlow = () => {
    setCurrentPb(null);
    setCurrentSku(null);
    setPbValue("");
    setSkuValue("");
    setQtyValue("");
    setError(null);
    setStep("pb");
  };

  const handlePbSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = pbValue.trim();
    if (!trimmed) return;

    if (!PB_REGEX.test(trimmed)) {
      setError(`Invalid PB format: "${trimmed}". Expected format like "PB.1", "PB.42", "PB.100".`);
      return;
    }

    setError(null);
    setCurrentPb(trimmed);
    setPbValue("");
    setStep("sku");
  };

  const handleSkuSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = skuValue.trim();
    if (!trimmed) return;
    if (!currentPb) return;

    setError(null);
    setCurrentSku(trimmed);
    setSkuValue("");
    setStep("qty");
  };

  const handleQtySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = qtyValue.trim();
    if (!trimmed) return;
    if (!currentPb || !currentSku) return;

    const n = Number(trimmed);
    if (!Number.isInteger(n) || n <= 0) {
      setError(`Invalid quantity: "${trimmed}". Must be a positive whole number.`);
      return;
    }

    setEntries((prev) => [{ pb: currentPb, sku: currentSku, qty: n }, ...prev]);
    resetFlow();
  };

  const removeAt = (idx: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== idx));
  };

  const heading =
    step === "pb" ? "Scan PB Number" : step === "sku" ? "Scan SKU ID" : "Enter Quantity";

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ScanLine size={18} className="text-muted-foreground" />
          <h3 className="text-sm font-medium">{heading}</h3>
          {currentPb && (
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
              <span className="font-mono px-2 py-0.5 rounded bg-secondary">{currentPb}</span>
              <ChevronRight size={12} />
              {currentSku ? (
                <>
                  <span className="font-mono px-2 py-0.5 rounded bg-secondary">{currentSku}</span>
                  <ChevronRight size={12} />
                  <span>Qty</span>
                </>
              ) : (
                <span>SKU</span>
              )}
            </span>
          )}
        </div>

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
            <Button type="submit" size="sm">Next</Button>
          </form>
        )}

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
            <Button type="button" size="sm" variant="ghost" onClick={resetFlow}>
              Cancel
            </Button>
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
            <Button type="submit" size="sm">Add</Button>
            <Button type="button" size="sm" variant="ghost" onClick={resetFlow}>
              Cancel
            </Button>
          </form>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">
          {step === "pb" && (
            <>Format must be <code className="px-1 py-0.5 rounded bg-secondary">PB.</code> followed by a number (e.g. PB.1, PB.250).</>
          )}
          {step === "sku" && <>Scan the SKU ID for <span className="font-mono">{currentPb}</span>.</>}
          {step === "qty" && (
            <>Enter quantity for <span className="font-mono">{currentSku}</span> in <span className="font-mono">{currentPb}</span>.</>
          )}
        </p>
      </div>

      {entries.length > 0 && (
        <div className="rounded-md border border-border bg-card">
          <div className="px-4 py-2 border-b border-border text-xs font-medium text-muted-foreground grid grid-cols-[1fr_2fr_auto_auto] gap-4">
            <span>PB</span>
            <span>SKU</span>
            <span>Qty</span>
            <span className="sr-only">Actions</span>
          </div>
          <ul className="divide-y divide-border">
            {entries.map((entry, i) => (
              <li
                key={`${entry.pb}-${entry.sku}-${i}`}
                className="grid grid-cols-[1fr_2fr_auto_auto] gap-4 items-center px-4 py-2 text-sm"
              >
                <span className="font-mono">{entry.pb}</span>
                <span className="font-mono truncate">{entry.sku}</span>
                <span className="font-mono tabular-nums text-right">{entry.qty}</span>
                <button
                  onClick={() => removeAt(i)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${entry.pb} / ${entry.sku}`}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
