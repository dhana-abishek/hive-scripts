import { useEffect, useRef, useState } from "react";
import { ScanLine, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const PB_REGEX = /^PB\.\d+$/;

export function InventoryDiscrepancies() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;

    if (!PB_REGEX.test(trimmed)) {
      setError(`Invalid format: "${trimmed}". Expected format like "PB.1", "PB.42", "PB.100".`);
      return;
    }

    setError(null);
    setScanned((prev) => [trimmed, ...prev]);
    setValue("");
    inputRef.current?.focus();
  };

  const removeAt = (idx: number) => {
    setScanned((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ScanLine size={18} className="text-muted-foreground" />
          <h3 className="text-sm font-medium">Scan PB Number</h3>
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            placeholder="e.g. PB.1, PB.42, PB.100"
            autoComplete="off"
            spellCheck={false}
            className={error ? "border-destructive focus-visible:ring-destructive" : ""}
          />
          <Button type="submit" size="sm">
            Add
          </Button>
        </form>

        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Format must be <code className="px-1 py-0.5 rounded bg-secondary">PB.</code> followed by a number (e.g. PB.1, PB.250).
        </p>
      </div>

      {scanned.length > 0 && (
        <div className="rounded-md border border-border bg-card">
          <div className="px-4 py-2 border-b border-border text-xs font-medium text-muted-foreground">
            Scanned ({scanned.length})
          </div>
          <ul className="divide-y divide-border">
            {scanned.map((pb, i) => (
              <li key={`${pb}-${i}`} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="font-mono">{pb}</span>
                <button
                  onClick={() => removeAt(i)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${pb}`}
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
