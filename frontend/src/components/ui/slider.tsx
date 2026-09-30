import { Slider as SliderPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

/** Trilho fino preenchido até o valor, polegar redondo. static/style.css:94-126
 *  (o `--p` do original é o próprio Range do Radix). */
function Slider({
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  "aria-describedby": ariaDescribedby,
  "aria-valuetext": ariaValuetext,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  // o Radix põe o role=slider no polegar: o nome acessível precisa ir para ele
  const thumbAria = {
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledby,
    "aria-describedby": ariaDescribedby,
    "aria-valuetext": ariaValuetext,
  };
  const count = (props.value ?? props.defaultValue ?? [props.min ?? 0]).length;
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex h-[22px] w-full cursor-pointer touch-none items-center select-none data-[disabled]:opacity-40",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-0.5 grow rounded-[1px] bg-linha">
        <SliderPrimitive.Range className="absolute h-full rounded-[1px] bg-grafite" />
      </SliderPrimitive.Track>
      {Array.from({ length: count }, (_, i) => (
        <SliderPrimitive.Thumb
          // biome-ignore lint/suspicious/noArrayIndexKey: polegares são posicionais
          key={i}
          {...thumbAria}
          className="block size-[18px] rounded-full border-[1.5px] border-grafite bg-papel focus-visible:shadow-[0_0_0_3px_var(--color-parede),0_0_0_5px_var(--color-viridian)] focus-visible:outline-none"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
