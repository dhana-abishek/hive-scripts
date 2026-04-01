import { Package, Clock, TrendingUp, AlertTriangle } from "lucide-react";

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
}

export function SummaryStats({ totalOrders, totalPickingHours, totalPackingHours, avgSph, merchantCount }: SummaryStatsProps) {
  return (
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
        subtext="Shipments per hour"
        variant="success"
      />
    </div>
  );
}
