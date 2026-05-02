import { useEffect, useMemo, useState } from "react";
import { Clock4, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ShiftConfig,
  clearShiftOverride,
  dateKey,
  getDefaultShift,
  getShiftForDate,
  setShiftOverride,
  useShiftConfig,
} from "@/hooks/useTimeLeft";

const FALLBACK: ShiftConfig = { start: "08:10", end: "16:40", lunchStart: "12:00", lunchEnd: "12:30" };

function todayInputValue(): string {
  return dateKey(new Date());
}

function parseDateInput(value: string): Date {
  // value is YYYY-MM-DD; build local-date to keep day stable
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function ShiftEditor() {
  const [open, setOpen] = useState(false);
  const [dateStr, setDateStr] = useState(todayInputValue);
  const date = useMemo(() => parseDateInput(dateStr), [dateStr]);
  const { effective, isOverridden } = useShiftConfig(date);

  const seed = effective ?? getDefaultShift(date) ?? FALLBACK;
  const [draft, setDraft] = useState<ShiftConfig>(seed);

  // When the dialog opens or the picked date changes, refresh the draft from current effective config.
  useEffect(() => {
    const cur = getShiftForDate(date) ?? getDefaultShift(date) ?? FALLBACK;
    setDraft(cur);
  }, [dateStr, open, date]);

  const handleSave = () => {
    setShiftOverride(date, draft);
    setOpen(false);
  };

  const handleResetDay = () => {
    clearShiftOverride(date);
    const cur = getDefaultShift(date) ?? FALLBACK;
    setDraft(cur);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-border bg-secondary text-foreground hover:bg-accent transition-colors"
          title="Edit shift timings"
        >
          <Clock4 size={12} />
          Shift
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit shift timings</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="shift-date">Date</Label>
            <Input
              id="shift-date"
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value || todayInputValue())}
            />
            <p className="text-xs text-muted-foreground">
              {isOverridden ? "Custom shift set for this date." : "Using the default shift for this weekday."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="shift-start">Shift start</Label>
              <Input
                id="shift-start"
                type="time"
                value={draft.start}
                onChange={(e) => setDraft({ ...draft, start: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shift-end">Shift end</Label>
              <Input
                id="shift-end"
                type="time"
                value={draft.end}
                onChange={(e) => setDraft({ ...draft, end: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lunch-start">Break start</Label>
              <Input
                id="lunch-start"
                type="time"
                value={draft.lunchStart}
                onChange={(e) => setDraft({ ...draft, lunchStart: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lunch-end">Break end</Label>
              <Input
                id="lunch-end"
                type="time"
                value={draft.lunchEnd}
                onChange={(e) => setDraft({ ...draft, lunchEnd: e.target.value })}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleResetDay}
            className="gap-1.5"
            disabled={!isOverridden}
          >
            <RotateCcw size={12} /> Reset day
          </Button>
          <Button type="button" size="sm" onClick={handleSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
