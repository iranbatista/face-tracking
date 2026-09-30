import { Dialog as DialogPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;
const DialogPortal = DialogPrimitive.Portal;

type Variant = "panel" | "lightbox";

/** `panel`: painel pequeno centralizado (static/style.css:537-542).
 *  `lightbox`: tela cheia sobre fundo de galeria (static/style.css:443-447). */
function DialogContent({
  className,
  variant = "panel",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { variant?: Variant }) {
  return (
    <DialogPortal>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className={cn("fixed inset-0 z-40", variant === "lightbox" ? "bg-parede" : "bg-[rgba(35,38,43,.28)]")}
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-variant={variant}
        className={cn(
          "fixed z-40 bg-papel text-grafite",
          variant === "lightbox"
            ? "inset-0 m-0 h-dvh w-screen max-w-none border-0 bg-parede p-0"
            : "top-1/2 left-1/2 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-[10px] border border-linha p-0 shadow-[0_24px_60px_-24px_rgba(35,38,43,.35)]",
          className,
        )}
        {...props}
      />
    </DialogPortal>
  );
}

/** `.panel-body` */
function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("grid gap-[1.1rem] px-7 pt-7 pb-2 mobile:px-5 mobile:pt-[1.4rem]", className)}
      {...props}
    />
  );
}

/** `.panel-foot` */
function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-7 pt-5 pb-6 mobile:flex-wrap mobile:px-5 mobile:pt-4 mobile:pb-5",
        className,
      )}
      {...props}
    />
  );
}

/** `.panel-body h2` */
function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("display text-[2rem]", className)} {...props} />;
}

const DialogDescription = DialogPrimitive.Description;

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
