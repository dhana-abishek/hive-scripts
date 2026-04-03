import { Package, Clock, TrendingUp, Users, Timer, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";

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
  avgSph: number;
  merchantCount: number;
  nonProdHeadcount: number;
  onNonProdHeadcountChange: (value: number) => void;
}

const TIME_LEFT = 8;

export function SummaryStats({
  totalOrders,
  totalPickingHours,
  totalPackingHours,
  merchantCount,
  nonProdHeadcount,
  onNonProdHeadcountChange,
}: SummaryStatsProps) {
  const pickingHeadcount = Math.ceil(totalPickingHours / TIME_LEFT);
  const packingHeadcount = Math.ceil(totalPackingHours / TIME_LEFT);
  const denominator = totalPickingHours + totalPackingHours + (nonProdHeadcount * TIME_LEFT);
  const avgSph = denominator > 0 ? totalOrders / denominator : 0;

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
          label="Picking Hours"
          value={totalPickingHours.toFixed(1)}
          icon={<Clock size={16} />}
          subtext="Hours needed"
          variant="warning"
        />
        <StatCard
          label="Packing Hours"
          value={totalPackingHours.toFixed(1)}
          icon={<Clock size={16} />}
          subtext="Hours needed"
          variant="warning"
        />
        <StatCard
          label="Avg Ideal SPH"
          value={avgSph.toFixed(1)}
          icon={<TrendingUp size={16} />}
          subtext="Orders / (Pick + Pack + NonProd hrs)"
          variant="success"
        />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Time Left"
          value={`${TIME_LEFT}h`}
          icon={<Timer size={16} />}
          subtext="Remaining shift hours"
        />
        <StatCard
          label="Picking Headcount"
          value={pickingHeadcount}
          icon={<Users size={16} />}
          subtext={`${totalPickingHours.toFixed(1)}h ÷ ${TIME_LEFT}h`}
          variant="warning"
        />
        <StatCard
          label="Packing Headcount"
          value={packingHeadcount}
          icon={<Users size={16} />}
          subtext={`${totalPackingHours.toFixed(1)}h ÷ ${TIME_LEFT}h`}
          variant="warning"
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
