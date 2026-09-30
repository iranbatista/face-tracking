import type * as React from "react";
import { cn } from "@/lib/utils";

/** static/style.css:127-131 (text/password) e 551-554 (date, dentro de .field) */
function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(
        "h-[42px] w-full min-w-0 appearance-none rounded-foco border border-linha bg-papel px-[.8rem] text-t-base font-normal placeholder:text-[#9A9EA5]",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
