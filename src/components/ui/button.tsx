import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ComponentProps } from "react";

// Adapted from the shadcn/ui Radix Button recipe. Project colors keep the existing dashboard palette.
const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 font-semibold disabled:pointer-events-none disabled:opacity-50",
  { variants: { variant: {
    default: "bg-emerald-950 text-white",
    outline: "border border-emerald-800 bg-white text-emerald-950",
    destructive: "border border-red-800 bg-white text-red-900",
  } }, defaultVariants: { variant: "default" } },
);

export function Button({ className, variant, asChild = false, ...props }:
  ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : "button";
  return <Component data-slot="button" className={twMerge(clsx(buttonVariants({ variant }), className))} {...props} />;
}
