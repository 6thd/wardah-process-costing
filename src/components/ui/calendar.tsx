import * as React from "react";
import { DayPicker } from "react-day-picker";
import { ar } from "date-fns/locale";
import "react-day-picker/style.css";
import "./calendar.css";
import { ChevronLeft, ChevronRight } from "lucide-react";

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
    const [currentMonth, setCurrentMonth] = React.useState(props.defaultMonth || new Date());

    const handlePreviousMonth = () => {
      setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
    };

    const handleNextMonth = () => {
      setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
    };

    const mergedClassNames = {
      months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
      month: "space-y-2",
      caption: "hidden",
      caption_label: "hidden",
      nav: "hidden",
      nav_button: "hidden",
      nav_button_previous: "hidden",
      nav_button_next: "hidden",
      table: "w-full border-collapse",
      weekdays: "",
      weekday: "text-center text-muted-foreground font-normal text-xs h-8 w-full p-1",
      day: "h-10 w-full p-0 font-normal text-sm hover:bg-accent hover:text-accent-foreground rounded-sm transition-colors",
      day_selected:
        "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground rounded-sm",
      day_today: "bg-accent/50 text-accent-foreground font-semibold rounded-sm",
      day_outside: "text-muted-foreground/40 opacity-50",
      day_disabled: "text-muted-foreground/30 line-through",
      day_range_middle: "bg-accent/50 text-accent-foreground rounded-none",
      day_hidden: "invisible",
      ...(classNames ?? {}),
    };

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

    return (
      <div ref={ref} dir="rtl" className={cn("bg-card rounded-lg border shadow-lg overflow-hidden", containerClassName)}>
        {/* Custom header with navigation */}
        <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b">
          <button
            onClick={handlePreviousMonth}
            className="h-7 w-7 bg-muted hover:bg-muted/80 rounded-md flex items-center justify-center transition-colors"
            aria-label="الشهر السابق"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          <div className="text-base font-semibold">
            {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
          </div>

          <button
            onClick={handleNextMonth}
            className="h-7 w-7 bg-muted hover:bg-muted/80 rounded-md flex items-center justify-center transition-colors"
            aria-label="الشهر التالي"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>

        {/* Weekday headers */}
        <div className="grid grid-cols-7 gap-0 border-b bg-muted/20">
          {weekdayLabels.map((day) => (
            <div
              key={day}
              className="text-center text-muted-foreground font-normal text-xs h-8 flex items-center justify-center border-l first:border-l-0"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar body */}
        <div className="p-3">
          <DayPicker
            month={currentMonth}
            onMonthChange={setCurrentMonth}
            locale={customArLocale}
            showOutsideDays={showOutsideDays}
            dir="rtl"
            className={cn("w-full", className)}
            classNames={mergedClassNames}
            weekStartsOn={6}
            hideWeekdays
            formatters={{
              formatWeekdayName: (date) => {
                const index = (date.getDay() + 1) % 7;
                return weekdayLabels[index];
              },
            }}
            {...props}
          />
        </div>
      </div>
    );
  }
);

Calendar.displayName = "Calendar";

export { Calendar };
