import { Package, Clock, Timer, UserPlus, ArrowDownToLine, Gauge, PackageMinus, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  subtext?: string;
  variant?: "default" | "success" | "warning" | "danger";
}

const variantStyles = {
  default: "border-border",
  success: "border-success/30",
  warning: "border-warning/30",
  danger: "border-destructive/30",
};

const iconStyles = {
  default: "text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
};

export function StatCard({ label, value, icon, subtext, variant = "default" }: StatCardProps) {
  return (
    <div className={`rounded-md border bg-card p-4 ${variantStyles[variant]}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="stat-label">{label}</span>
        <span className={iconStyles[variant]}>{icon}</span>
      </div>
      <div className="stat-value text-foreground">{value}</div>
      {subtext && <p className="text-xs text-muted-foreground mt-1">{subtext}</p>}
    </div>
  );
}

interface SummaryStatsProps {
  totalOrders: number;
  totalPickingHours: number;
  totalPackingHours: number;
  merchantCount: number;
  nonProdHeadcount: number;
  onNonProdHeadcountChange: (value: number) => void;
  totalPlannedBacklog?: number;
  adjustedSph?: number;
  onResetBacklog?: () => void;
}

function calcTimeLeft(): number {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 6=Sat
  const h = now.getHours();
  const m = now.getMinutes();
  const s = now.getSeconds();
  const nowFrac = (h * 3600 + m * 60 + s) / 86400; // fraction of day

  const t = (hh: number, mm: number, ss: number) => (hh * 3600 + mm * 60 + ss) / 86400;

  const start = t(8, 10, 0);
  const lunchStart = t(12, 0, 0);
  const lunchEnd = t(12, 30, 0);
  const lunchDur = t(0, 30, 0);

  if (day === 0) return 8; // Sunday
  if (nowFrac < start) return 8; // before shift

  const endTime = day === 6 ? t(15, 0, 0) : t(16, 40, 0);
  if (nowFrac >= endTime) return 8; // after shift ends → next day

  const totalShift = (endTime - start - lunchDur) * 24;

  let elapsed: number;
  if (nowFrac < lunchStart) {
    elapsed = (nowFrac - start) * 24;
  } else if (nowFrac < lunchEnd) {
    elapsed = (lunchStart - start) * 24;
  } else {
    elapsed = (lunchStart - start) * 24 + (nowFrac - lunchEnd) * 24;
  }

  return Math.max(0, totalShift - elapsed);
}

const TIME_LEFT = calcTimeLeft();

export function SummaryStats({
  totalOrders,
  totalPickingHours,
  totalPackingHours,
  merchantCount,
  nonProdHeadcount,
  onNonProdHeadcountChange,
  totalPlannedBacklog = 0,
  adjustedSph = 0,
  onResetBacklog,
}: SummaryStatsProps) {
  const pickingHeadcount = Math.ceil(totalPickingHours / TIME_LEFT);
  const packingHeadcount = Math.ceil(totalPackingHours / TIME_LEFT);
  const effectiveOrders = Math.max(0, totalOrders - totalPlannedBacklog);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total Orders"
          value={totalOrders.toLocaleString()}
          icon={<Package size={16} />}
          subtext={`${merchantCount} merchants`}
        />
        <StatCard
          label="Effective Orders"
          value={effectiveOrders.toLocaleString()}
          icon={<PackageMinus size={16} />}
          subtext={`After ${totalPlannedBacklog} backlog`}
          variant="success"
        />
        <div className="rounded-md border bg-card p-4 border-warning/30">
          <div className="flex items-center justify-between mb-2">
            <span className="stat-label">Picking</span>
            <span className="text-warning"><Clock size={16} /></span>
          </div>
          <div className="stat-value text-foreground">{totalPickingHours.toFixed(1)}h</div>
          <p className="text-xs text-muted-foreground mt-1">
            <span className="font-semibold text-foreground">{pickingHeadcount} HC</span> needed ({totalPickingHours.toFixed(1)}h ÷ {TIME_LEFT}h)
          </p>
        </div>
        <div className="rounded-md border bg-card p-4 border-warning/30">
          <div className="flex items-center justify-between mb-2">
            <span className="stat-label">Packing</span>
            <span className="text-warning"><Clock size={16} /></span>
          </div>
          <div className="stat-value text-foreground">{totalPackingHours.toFixed(1)}h</div>
          <p className="text-xs text-muted-foreground mt-1">
            <span className="font-semibold text-foreground">{packingHeadcount} HC</span> needed ({totalPackingHours.toFixed(1)}h ÷ {TIME_LEFT}h)
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Time Left"
          value={`${TIME_LEFT}h`}
          icon={<Timer size={16} />}
          subtext="Remaining shift hours"
        />
        <div className="relative h-full">
          <StatCard
            label="Planned Backlog"
            value={totalPlannedBacklog.toLocaleString()}
            icon={<ArrowDownToLine size={16} />}
            subtext="Orders deferred"
          />
          {totalPlannedBacklog > 0 && onResetBacklog && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-8 right-2 h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={onResetBacklog}
              title="Reset all planned backlog to 0"
            >
              <RotateCcw size={12} className="mr-1" /> Reset
            </Button>
          )}
        </div>
        <StatCard
          label="Adjusted SPH"
          value={adjustedSph.toFixed(1)}
          icon={<Gauge size={16} />}
          subtext="SPH after backlog"
          variant="success"
        />
        <div className="rounded-md border bg-card p-4 border-primary/30">
          <div className="flex items-center justify-between mb-2">
            <span className="stat-label">Non-Prod Headcount</span>
            <span className="text-primary"><UserPlus size={16} /></span>
          </div>
          <Input
            type="number"
            min={0}
            value={nonProdHeadcount}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              onNonProdHeadcountChange(isNaN(v) || v < 0 ? 0 : v);
            }}
            className="h-8 text-lg font-bold w-20 bg-secondary border-border"
          />
          <p className="text-xs text-muted-foreground mt-1">Enter headcount</p>
        </div>
      </div>
    </div>
  );
}
