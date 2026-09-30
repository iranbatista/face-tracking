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
  const { min = 0, max = 100, step = 1, onValueChange, onValueCommit } = props;
  // PageUp/PageDown: o <input type=range> nativo anda ~10% do intervalo (arredondado ao passo);
  // o Radix anda 10 passos. Só para polegar único e Slider controlado.
  function onThumbKeyDown(e: React.KeyboardEvent<HTMLSpanElement>) {
    if ((e.key !== "PageUp" && e.key !== "PageDown") || props.value?.length !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    const steps = Math.max(1, Math.round(Math.round(((max - min) * 0.1 * 1e6) / step) / 1e6));
    const current = props.value[0] as number;
    const next = current + (e.key === "PageUp" ? steps : -steps) * step;
    const clamped = Math.min(max, Math.max(min, next));
    const value = Number((Math.round((clamped - min) / step) * step + min).toFixed(6));
    if (value === current) return;
    onValueChange?.([value]);
    onValueCommit?.([value]);
  }
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
          onKeyDown={onThumbKeyDown}
          className="block size-[18px] rounded-full border-[1.5px] border-grafite bg-papel focus-visible:shadow-[0_0_0_3px_var(--color-parede),0_0_0_5px_var(--color-viridian)] focus-visible:outline-none"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
