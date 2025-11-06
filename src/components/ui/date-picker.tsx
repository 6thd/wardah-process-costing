import * as React from "react"
import { format } from "date-fns"
import { ar } from "date-fns/locale"
import { Calendar as CalendarIcon, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface DatePickerProps {
  date?: Date
  onSelect?: (date: Date | undefined) => void
  placeholder?: string
  disabled?: boolean
  minDate?: Date
  className?: string
  id?: string
}

export function DatePicker({
  date,
  onSelect,
  placeholder = "اختر التاريخ",
  disabled = false,
  minDate,
  className,
  id,
}: DatePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false)

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant={"outline"}
          className={cn(
            "w-full justify-start text-right font-normal",
            !date && "text-muted-foreground",
            className
          )}
          disabled={disabled}
        >
          <CalendarIcon className="ml-2 h-4 w-4" />
          {date ? (
            <span className="flex-1 text-right">
              {format(date, "dd/MM/yyyy")}
            </span>
          ) : (
            <span className="flex-1 text-right">{placeholder}</span>
          )}
          {date && !disabled && (
            <X
              className="mr-2 h-4 w-4 opacity-50 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation()
                onSelect?.(undefined)
              }}
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(selectedDate) => {
            onSelect?.(selectedDate)
            setIsOpen(false)
          }}
          disabled={minDate ? (date) => date < minDate : undefined}
          initialFocus
          locale={ar}
          dir="rtl"
          className="rounded-md border"
        />
      </PopoverContent>
    </Popover>
  )
}
