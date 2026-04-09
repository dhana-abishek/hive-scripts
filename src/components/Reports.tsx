import { useState, useMemo, useCallback, useEffect } from "react";
import { Copy, Check, FileText } from "lucide-react";
import { cloudGet, cloudSet } from "@/lib/cloudStorage";
import { useTimeLeft } from "@/hooks/useTimeLeft";
import { buildZoneLookup } from "@/data/zoneMappings";
import { Input } from "@/components/ui/input";

const MULTIPLIER = 1.125;

interface FlowRow {
  merchant_name: string;
  order_volume: number;
  waiting_for_picking: number;
  picking_hours: number;
  packing_hours: number;
  ideal_sph: number;
}

interface ReportsProps {
  mergedFlowData: FlowRow[];
  backlog: Record<string, number>;
  pickingRates: Record<string, number>;
  packingRates: Record<string, number>;
  overallTotalOrders: number;
  overallTotalBacklog: number;
  overallAdjustedSph: number;
  availableHeadcount: number;
  nonProdHeadcount: number;
}

interface ReportData {
  planToShip: number;
  hcHours: number;
  plannedSph: number;
  plannedBacklog: number;
}

function useClipboard(timeout = 2000) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), timeout);
    } catch {
      // fallback
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), timeout);
    }
  }, [timeout]);
  return { copied, copy };
}

function formatReport(title: string, data: ReportData): string {
  return [
    title,
    `Plan to ship: ${data.planToShip.toLocaleString()}`,
    `HC Hours: ${data.hcHours.toFixed(1)}`,
    `Planned SPH: ${data.plannedSph.toFixed(1)}`,
    `Planned Backlog: ${data.plannedBacklog.toLocaleString()}`,
  ].join("\n");
}

interface ReportCardProps {
  title: string;
  data: ReportData;
  hcAvailable: number;
  onHcChange: (val: number) => void;
  timeLeft: number;
  hcLabel?: string;
}

function ReportCard({ title, data, hcAvailable, onHcChange, timeLeft, hcLabel }: ReportCardProps) {
  const { copied, copy } = useClipboard();

  const handleCopy = () => {
    copy(formatReport(title, data));
  };

  const rows: { label: string; value: string }[] = [
    { label: "Plan to ship", value: data.planToShip.toLocaleString() },
    { label: "HC Hours", value: `${data.hcHours.toFixed(1)} (${hcAvailable} HC × ${timeLeft.toFixed(1)}h)` },
    { label: "Planned SPH", value: data.plannedSph.toFixed(1) },
    { label: "Planned Backlog", value: data.plannedBacklog.toLocaleString() },
  ];

  return (
    <div className="rounded-lg border bg-card flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-secondary/40">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-primary" />
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-border bg-secondary text-foreground hover:bg-accent transition-colors"
        >
          {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      <div className="px-4 py-4 space-y-3 flex-1">
        {/* HC Available input */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-xs text-muted-foreground">{hcLabel ?? "HC Available"}</span>
          <Input
            type="number"
            min={0}
            step={1}
            value={hcAvailable || ""}
            placeholder="0"
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              onHcChange(isNaN(v) || v < 0 ? 0 : v);
            }}
            className="h-7 w-20 text-right text-sm font-bold bg-secondary border-border"
          />
        </div>

        <div className="rounded-md border divide-y">
          {rows.map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-muted-foreground">{label}</span>
              <span className="text-sm font-semibold tabular-nums">{value}</span>
            </div>
          ))}
        </div>

        {/* Preview of copied text */}
        <pre className="text-[11px] text-muted-foreground font-mono bg-secondary/60 rounded-md px-3 py-2 whitespace-pre leading-5 select-all">
          {formatReport(title, data)}
        </pre>
      </div>
    </div>
  );
}

export function Reports({
  mergedFlowData,
  backlog,
  pickingRates,
  packingRates,
  overallTotalOrders,
  overallTotalBacklog,
  overallAdjustedSph,
  availableHeadcount,
}: ReportsProps) {
  const timeLeft = useTimeLeft();

  const [allHC, setAllHC] = useState(0);
  const [zoneAHC, setZoneAHC] = useState(0);
  const [zoneBHC, setZoneBHC] = useState(0);
  const [zoneANonProdHC, setZoneANonProdHC] = useState(6);
  const [zoneBNonProdHC, setZoneBNonProdHC] = useState(6);

  // Initialise from cloud storage
  useEffect(() => {
    Promise.all([
      cloudGet<number>("availableHC_main"),
      cloudGet<number>("availableHC_zoneA"),
      cloudGet<number>("availableHC_zoneB"),
      cloudGet<number>("nonProdHC_zoneA"),
      cloudGet<number>("nonProdHC_zoneB"),
    ]).then(([aMain, aA, aB, npA, npB]) => {
      setAllHC(aMain ?? availableHeadcount);
      if (aA !== null) setZoneAHC(aA);
      if (aB !== null) setZoneBHC(aB);
      if (npA !== null) setZoneANonProdHC(npA);
      if (npB !== null) setZoneBNonProdHC(npB);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep allHC in sync with the prop when it changes from the main tab
  useEffect(() => {
    setAllHC(availableHeadcount);
  }, [availableHeadcount]);

  const handleAllHCChange = (val: number) => {
    setAllHC(val);
    void cloudSet("availableHC_main", val);
  };
  const handleZoneAHCChange = (val: number) => {
    setZoneAHC(val);
    void cloudSet("availableHC_zoneA", val);
  };
  const handleZoneBHCChange = (val: number) => {
    setZoneBHC(val);
    void cloudSet("availableHC_zoneB", val);
  };

  const zoneLookup = useMemo(() => buildZoneLookup(), []);

  const computeZoneData = useCallback(
    (zone: "A" | "B", nonProdHC: number, hcAvailable: number): ReportData => {
      let totalOrders = 0;
      let totalBacklog = 0;
      let adjPickHrs = 0;
      let adjPackHrs = 0;
      let adjVolume = 0;

      for (const row of mergedFlowData) {
        const assignment = zoneLookup[row.merchant_name];
        if (!assignment || assignment.zone !== zone) continue;

        const bl = backlog[row.merchant_name] || 0;
        const effectiveVol = Math.max(0, row.order_volume - bl);
        const effectiveWaiting = Math.max(0, row.waiting_for_picking - bl);
        const key = row.merchant_name.toLowerCase();
        const pickRate = pickingRates[key] || 30;
        const packRate = packingRates[key] || 20;

        totalOrders += row.order_volume;
        totalBacklog += bl;
        adjPickHrs += effectiveWaiting / (pickRate * MULTIPLIER);
        adjPackHrs += effectiveVol / (packRate * MULTIPLIER);
        adjVolume += effectiveVol;
      }

      const denom = adjPickHrs + adjPackHrs + nonProdHC * timeLeft;
      const plannedSph = denom > 0 ? adjVolume / denom : 0;

      return {
        planToShip: totalOrders,
        hcHours: hcAvailable * timeLeft,
        plannedSph,
        plannedBacklog: totalBacklog,
      };
    },
    [mergedFlowData, backlog, pickingRates, packingRates, zoneLookup, timeLeft]
  );

  const allData = useMemo<ReportData>(
    () => ({
      planToShip: overallTotalOrders,
      hcHours: allHC * timeLeft,
      plannedSph: overallAdjustedSph,
      plannedBacklog: overallTotalBacklog,
    }),
    [overallTotalOrders, overallTotalBacklog, overallAdjustedSph, allHC, timeLeft]
  );

  const zoneAData = useMemo(
    () => computeZoneData("A", zoneANonProdHC, zoneAHC),
    [computeZoneData, zoneANonProdHC, zoneAHC]
  );

  const zoneBData = useMemo(
    () => computeZoneData("B", zoneBNonProdHC, zoneBHC),
    [computeZoneData, zoneBNonProdHC, zoneBHC]
  );

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-secondary/30 px-4 py-3 text-xs text-muted-foreground">
        SOS (Start of Shift) reports are auto-calculated from the current Flow Management data.
        Adjust HC Available per scope and click <strong>Copy</strong> to paste the report.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ReportCard
          title="All Merchants"
          data={allData}
          hcAvailable={allHC}
          onHcChange={handleAllHCChange}
          timeLeft={timeLeft}
        />
        <ReportCard
          title="Zone A"
          data={zoneAData}
          hcAvailable={zoneAHC}
          onHcChange={handleZoneAHCChange}
          timeLeft={timeLeft}
          hcLabel={`HC Available (non-prod: ${zoneANonProdHC})`}
        />
        <ReportCard
          title="Zone B"
          data={zoneBData}
          hcAvailable={zoneBHC}
          onHcChange={handleZoneBHCChange}
          timeLeft={timeLeft}
          hcLabel={`HC Available (non-prod: ${zoneBNonProdHC})`}
        />
      </div>
    </div>
  );
}
