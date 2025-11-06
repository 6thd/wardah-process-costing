import * as React from "react";
import { DayPicker } from "react-day-picker";
import type { WeekdaysProps } from "react-day-picker";
import { ar } from "date-fns/locale";
import "react-day-picker/style.css";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker> & {
  containerClassName?: string;
};

const weekdayLabels = [
  "السبت",
  "الأحد",
  "الاثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
];

const customArLocale = {
  ...ar,
  options: {
    ...ar.options,
    weekStartsOn: 6 as const,
  },
};

function EmptyWeekdays({ className, ...trProps }: WeekdaysProps) {
  return (
    <thead aria-hidden>
      <tr {...trProps} className={cn("hidden", className)} />
    </thead>
  );
}

const Calendar = React.forwardRef<HTMLDivElement, CalendarProps>(
  (
    {
      className,
      classNames,
      containerClassName,
      showOutsideDays = true,
      ...props
    },
    ref
  ) => {
    const mergedClassNames = {
      months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
      month: "space-y-4",
      caption: "flex justify-center pt-1 relative items-center mb-2",
      caption_label: "text-base font-semibold",
      nav: "space-x-1 flex items-center",
      nav_button: cn(
        buttonVariants({ variant: "outline" }),
        "h-8 w-8 bg-transparent p-0 opacity-70 hover:opacity-100"
      ),
      nav_button_previous: "absolute left-1",
      nav_button_next: "absolute right-1",
      table: "w-full border-collapse table-fixed",
      day: cn(
        buttonVariants({ variant: "ghost" }),
        "h-9 w-9 p-0 font-normal aria-selected:opacity-100 hover:bg-accent hover:text-accent-foreground"
      ),
      day_selected:
        "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground rounded-md",
      day_today:
        "bg-accent text-accent-foreground font-bold border-2 border-primary rounded-md",
      day_outside: "text-muted-foreground opacity-40",
      day_disabled: "text-muted-foreground opacity-30 line-through",
      day_range_middle:
        "aria-selected:bg-accent aria-selected:text-accent-foreground",
      day_hidden: "invisible",
      ...(classNames ?? {}),
      head_row: "hidden",
      head_cell: "hidden",
    };

    return (
      <div ref={ref} dir="rtl" className={cn("p-3", containerClassName)}>
        <div className="grid grid-cols-7 gap-0 mb-2 text-muted-foreground font-bold text-sm">
          {weekdayLabels.map((day) => (
            <div key={day} className="text-center">
              {day}
            </div>
          ))}
        </div>

        <DayPicker
          locale={customArLocale}
          showOutsideDays={showOutsideDays}
          dir="rtl"
          className={cn("p-0", className)}
          classNames={mergedClassNames}
          weekStartsOn={6}
          components={{
            Weekdays: EmptyWeekdays,
          }}
          labels={{
            labelMonthDropdown: () => "شهر",
            labelYearDropdown: () => "سنة",
            labelNext: () => "الشهر التالي",
            labelPrevious: () => "الشهر السابق",
          }}
          formatters={{
            formatCaption: (date) => {
              const monthNames = [
                "يناير",
                "فبراير",
                "مارس",
                "أبريل",
                "مايو",
                "يونيو",
                "يوليو",
                "أغسطس",
                "سبتمبر",
                "أكتوبر",
                "نوفمبر",
                "ديسمبر",
              ];
              return `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
            },
            formatWeekdayName: (date) => {
              const index = (date.getDay() + 1) % 7;
              return weekdayLabels[index];
            },
          }}
          {...props}
        />
      </div>
    );
  }
);

Calendar.displayName = "Calendar";

export { Calendar };
