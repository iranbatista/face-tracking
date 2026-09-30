import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

/** Botões do Foco. static/style.css:75-93 (.btn, .btn.primary, .icon-btn),
 *  348-352 (.icon-btn.small) e 556-565 (.text-btn, .btn.danger). */
const buttonVariants = cva(
  "inline-flex cursor-pointer items-center whitespace-nowrap no-underline disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        default:
          "h-[42px] justify-center gap-2 rounded-foco border border-linha bg-papel px-[1.05rem] text-[.92rem] leading-none font-medium tracking-[.005em] text-grafite transition-[border-color,background-color] duration-150 not-disabled:hover:border-grafite disabled:border-linha disabled:opacity-40",
        primary:
          "h-[42px] justify-center gap-2 rounded-foco border border-grafite bg-grafite px-[1.05rem] text-[.92rem] leading-none font-medium tracking-[.005em] text-papel transition-[border-color,background-color] duration-150 not-disabled:hover:bg-grafite-2 disabled:border-linha disabled:opacity-40",
        danger:
          "h-[42px] justify-center gap-2 rounded-foco border border-erro bg-erro px-[1.05rem] text-[.92rem] leading-none font-medium tracking-[.005em] text-papel transition-[border-color,background-color] duration-150 not-disabled:hover:bg-[#82241F] disabled:opacity-40",
        text: "h-[42px] gap-[.4rem] border-0 bg-transparent px-[.4rem] text-[.92rem] font-medium text-chumbo underline-offset-[3px] hover:underline disabled:opacity-40",
        "text-danger":
          "h-[42px] gap-[.4rem] border-0 bg-transparent px-[.4rem] text-[.92rem] font-medium text-erro underline-offset-[3px] hover:underline disabled:opacity-40",
        icon: "grid size-[42px] place-content-center place-items-center rounded-full border border-linha bg-papel not-disabled:hover:border-grafite disabled:opacity-40",
      },
      size: { default: "", small: "" },
    },
    compoundVariants: [{ variant: "icon", size: "small", className: "size-8 [&_.ico]:size-4" }],
    defaultVariants: { variant: "default", size: "default" },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      // `type="button"` por padrão: dentro de <form> o navegador assume submit
      {...(asChild ? {} : { type: type ?? "button" })}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
