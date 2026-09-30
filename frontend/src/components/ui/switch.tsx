import { Switch as SwitchPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

/** O verde de foco marca o estado ligado. static/style.css:600-613 */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative m-0 h-[26px] w-11 flex-none cursor-pointer rounded-[13px] bg-linha p-0 shadow-[inset_0_0_0_1px_var(--color-chumbo)] transition-colors duration-150 data-[state=checked]:bg-viridian data-[state=checked]:shadow-none aria-[busy=true]:cursor-wait aria-[busy=true]:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none absolute top-[3px] left-[3px] block size-5 rounded-full bg-papel shadow-[0_1px_2px_rgba(35,38,43,.25)] transition-transform duration-150 data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
