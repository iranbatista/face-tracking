import { Toaster as Sonner, type ToasterProps, toast } from "sonner";
import { Icon } from "@/components/Icon";

/** Como o `#toast` antigo (static/style.css:471-475): pílula grafite com check + texto, ~2,2 s.
 *  Uso: `toast.success("Evento salvo")`. */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="light"
      position="bottom-center"
      duration={2200}
      offset={{ bottom: "calc(24px + env(safe-area-inset-bottom))" }}
      icons={{ success: <Icon name="check" /> }}
      style={{ "--width": "max-content" } as React.CSSProperties}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex items-center gap-2 rounded-foco bg-grafite px-4 py-[.7rem] font-sans text-t-sm text-papel",
          icon: "flex",
        },
      }}
      {...props}
    />
  );
}

export { Toaster, toast };
