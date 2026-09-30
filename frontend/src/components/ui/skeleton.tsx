import type * as React from "react";
import { cn } from "@/lib/utils";

/** Bloco passe-partout com pulso (o `pulse` de static/style.css:533), parado com `motion-reduce`. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("bg-passe motion-safe:animate-foco-pulse", className)}
      {...props}
    />
  );
}

export { Skeleton };
