import { useState } from "react";
import { format, parse, isValid } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DatePickerProps {
  value: string; // "YYYY-MM-DD" string
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
}

export function DatePicker({ value, onChange, placeholder = "Pick a date", required, className }: DatePickerProps) {
  const [open, setOpen] = useState(false);

  const dateObj = value ? parse(value, "yyyy-MM-dd", new Date()) : undefined;
  const validDate = dateObj && isValid(dateObj) ? dateObj : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "w-full h-9 px-3 text-sm bg-background border border-card-border rounded-md text-left flex items-center justify-between gap-2 hover:bg-muted/50 transition-colors",
            !value && "text-muted-foreground",
            className
          )}
        >
          <span className={cn("truncate", value ? "text-foreground" : "text-muted-foreground")}>
            {validDate ? format(validDate, "MM/dd/yyyy") : placeholder}
          </span>
          <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 z-[70]" align="start">
        <Calendar
          mode="single"
          selected={validDate}
          onSelect={(day) => {
            if (day) {
              onChange(format(day, "yyyy-MM-dd"));
            }
            setOpen(false);
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
