import { Languages } from "lucide-react"
import { useTranslation } from 'react-i18next'

import { Button, type ButtonProps } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useUIStore } from "@/store/ui-store"

export function LanguageToggle() {
  const { i18n } = useTranslation()
  const { setLanguage } = useUIStore()

  const handleLanguageChange = (lang: 'ar' | 'en') => {
    i18n.changeLanguage(lang)
    setLanguage(lang)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button {...{variant: "ghost", size: "sm", className: "h-9 w-9 p-0"} as ButtonProps}>
          <Languages className="h-4 w-4" />
          <span className="sr-only">Toggle language</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem 
          onClick={() => handleLanguageChange('ar')}
          className={i18n.language === 'ar' ? 'bg-accent' : ''}
        >
          🇸🇦 العربية
        </DropdownMenuItem>
        <DropdownMenuItem 
          onClick={() => handleLanguageChange('en')}
          className={i18n.language === 'en' ? 'bg-accent' : ''}
        >
          🇺🇸 English
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}