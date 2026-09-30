import { Label as LabelPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

/** `.field`: rótulo acima do campo (o Label envolve o Input, como no original).
 *  static/style.css:548-550 */
function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn("grid gap-[.4rem] text-t-sm font-medium", className)}
      {...props}
    />
  );
}

/** `<em>opcional</em>` do `.field em`. Vai dentro do texto do rótulo, como no original:
 *  `<Label><span>Local <Optional /></span><Input /></Label>` */
function Optional({ children = "opcional", className, ...props }: React.ComponentProps<"em">) {
  return (
    <em className={cn("ml-[.3rem] font-normal text-chumbo not-italic", className)} {...props}>
      {children}
    </em>
  );
}

export { Label, Optional };
