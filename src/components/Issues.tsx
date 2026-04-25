import { useState } from "react";
import { AgingBaskets } from "./issues/AgingBaskets";
import { InventoryDiscrepancies } from "./issues/InventoryDiscrepancies";
import { LostAndFound } from "./issues/LostAndFound";

type SubTab = "aging" | "inventory" | "lost";

const tabs: { value: SubTab; label: string }[] = [
  { value: "aging", label: "Aging Baskets" },
  { value: "inventory", label: "Inventory Discrepancies" },
  { value: "lost", label: "Lost & Found" },
];

export function Issues() {
  const [tab, setTab] = useState<SubTab>("aging");

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-md border border-border bg-secondary p-0.5">
        {tabs.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-3 h-8 text-xs rounded transition-colors ${
              tab === t.value
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-accent"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "aging" && <AgingBaskets />}
      {tab === "inventory" && <InventoryDiscrepancies />}
      {tab === "lost" && <LostAndFound />}
    </div>
  );
}
