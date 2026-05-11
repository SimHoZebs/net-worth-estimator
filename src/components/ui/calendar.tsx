import * as React from "react";
import { DayPicker, getDefaultClassNames, type DayPickerProps } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: DayPickerProps) {
  const defaultClassNames = getDefaultClassNames();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        root: cn("w-full", defaultClassNames.root),
        months: "flex flex-col gap-4 lg:flex-row",
        month: "relative space-y-4",
        month_caption: "flex h-9 items-center justify-center px-10 text-sm font-semibold text-slate-900",
        caption_label: "text-sm font-semibold",
        nav: "absolute right-0 top-0 flex items-center gap-1",
        button_previous: cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "text-slate-500"),
        button_next: cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "text-slate-500"),
        chevron: "h-4 w-4",
        month_grid: "w-full border-collapse",
        weekdays: "border-b border-slate-100",
        weekday: "h-8 px-0 text-center text-[0.7rem] font-medium uppercase tracking-[0.12em] text-slate-400",
        week: "",
        day: "p-0 text-center align-middle",
        day_button: cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "h-9 w-9 rounded-full text-sm font-normal text-slate-700 aria-selected:opacity-100",
        ),
        today: "[&_button]:border [&_button]:border-slate-300 [&_button]:text-slate-900",
        selected: "[&_button]:bg-slate-900 [&_button]:text-white [&_button]:hover:bg-slate-900",
        outside: "text-slate-300 [&_button]:text-slate-300",
        disabled: "opacity-30 [&_button]:cursor-not-allowed [&_button]:hover:bg-transparent",
        hidden: "invisible",
        ...classNames,
      }}
      {...props}
    />
  );
}

Calendar.displayName = "Calendar";

export { Calendar };
