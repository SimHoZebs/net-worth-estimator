import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-transparent text-sm font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-slate-300 dark:focus-visible:ring-slate-600 focus-visible:ring-offset-2 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-red-500 dark:aria-invalid:border-red-400 aria-invalid:ring-2 aria-invalid:ring-red-200 dark:aria-invalid:ring-red-800 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100",
        outline: "border-slate-200 bg-white text-slate-900 hover:bg-slate-50 aria-expanded:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700/80 dark:aria-expanded:bg-slate-700/80",
        secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200 aria-expanded:bg-slate-200 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 dark:aria-expanded:bg-slate-600",
        ghost: "text-slate-700 hover:bg-slate-100 hover:text-slate-900 aria-expanded:bg-slate-100 aria-expanded:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/80 dark:hover:text-slate-100 dark:aria-expanded:bg-slate-700/80 dark:aria-expanded:text-slate-100",
        destructive: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 focus-visible:ring-red-200 dark:border-red-900 dark:bg-red-950 dark:text-red-400 dark:hover:bg-red-900/30 dark:focus-visible:ring-red-800",
        link: "border-none px-0 text-slate-900 dark:text-slate-100 underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        xs: "h-7 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 rounded-md px-3 text-sm [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 px-5 text-sm",
        icon: "size-8",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-md",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants>) {

  return (
    <button
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
