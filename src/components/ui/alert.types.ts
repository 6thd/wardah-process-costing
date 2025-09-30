import type { VariantProps } from "class-variance-authority"
import type { HTMLAttributes } from "react"
import type { alertVariants } from "./alert"

export type AlertProps = HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>