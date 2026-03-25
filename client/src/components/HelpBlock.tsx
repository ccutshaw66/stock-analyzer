import { useState } from "react";
import { Info, ChevronDown, ChevronUp } from "lucide-react";

/** Collapsible blue info bar — matches the calculator page format */
export function HelpBlock({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-primary/20 bg-primary/5 rounded-lg mb-4">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-primary hover:text-primary/80">
        <Info className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 text-left">{title}</span>
        <span className="text-[10px] text-muted-foreground">{open ? "Hide" : "Show"}</span>
      </button>
      {open && <div className="px-3 pb-3 text-xs text-muted-foreground leading-relaxed space-y-2">{children}</div>}
    </div>
  );
}

/** Inline example block with colored left border */
export function Example({ type, children }: { type: "good" | "bad" | "neutral"; children: React.ReactNode }) {
  const borderColor = type === "good" ? "border-green-500/50" : type === "bad" ? "border-red-500/50" : "border-yellow-500/50";
  return <div className={`border-l-2 ${borderColor} pl-2`}>{children}</div>;
}

/** Score range indicator */
export function ScoreRange({ label, range, color, description }: { label: string; range: string; color: "green" | "red" | "yellow"; description: string }) {
  const colorClass = color === "green" ? "text-green-400" : color === "red" ? "text-red-400" : "text-yellow-400";
  const bgClass = color === "green" ? "bg-green-500/15" : color === "red" ? "bg-red-500/15" : "bg-yellow-500/15";
  return (
    <div className="flex items-start gap-2">
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${bgClass} ${colorClass} shrink-0 mt-0.5`}>{range}</span>
      <div>
        <span className={`font-semibold ${colorClass}`}>{label}</span>
        <span className="text-muted-foreground"> — {description}</span>
      </div>
    </div>
  );
}
