import { Select as SelectPrimitive } from "radix-ui";
import * as React from "react";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/utils";

const Select = SelectPrimitive.Root;

/** `.picker-btn`: rótulo pequeno ("Evento") + valor + chevron. static/style.css:565-575 */
function SelectTrigger({
  className,
  label,
  placeholder,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & { label?: string; placeholder?: string }) {
  // role=combobox não tira o nome do conteúdo: o nome é o rótulo visível + o valor ("Evento Corrida")
  const labelId = React.useId();
  const valueId = React.useId();
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      aria-labelledby={label ? `${labelId} ${valueId}` : undefined}
      className={cn(
        "inline-flex h-[42px] max-w-[340px] cursor-pointer items-center gap-[.6rem] rounded-foco border border-linha bg-papel pr-[.8rem] pl-[.9rem] hover:border-grafite mobile:w-full mobile:max-w-none",
        className,
      )}
      {...props}
    >
      {label && (
        <span id={labelId} className="text-t-xs text-chumbo">
          {label}
        </span>
      )}
      <span id={valueId} className="truncate text-t-sm font-medium mobile:flex-1 mobile:text-left">
        <SelectPrimitive.Value placeholder={placeholder} />
      </span>
      <Icon name="chev-d" className="text-chumbo" />
    </SelectPrimitive.Trigger>
  );
}

/** `.picker-list` */
function SelectContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position="popper"
        align="start"
        sideOffset={6}
        className={cn(
          "z-50 max-h-80 w-max max-w-[min(420px,90vw)] min-w-(--radix-select-trigger-width) overflow-auto rounded-lg border border-linha bg-papel p-[.35rem] shadow-[0_18px_40px_-18px_rgba(35,38,43,.3)]",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

/** Item: nome + `hint` à direita ("N fotos"). O `hint` fica fora do ItemText
 *  para o valor mostrado no gatilho ser só o nome. */
function SelectItem({
  className,
  children,
  hint,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item> & { hint?: React.ReactNode }) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "flex cursor-pointer justify-between gap-6 rounded-[4px] px-[.7rem] py-[.6rem] text-t-sm outline-none data-[highlighted]:bg-parede data-[state=checked]:font-medium",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      {hint != null && <span className="num text-chumbo">{hint}</span>}
    </SelectPrimitive.Item>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger };
