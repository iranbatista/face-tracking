import { Toaster as Sonner, type ToasterProps, toast } from "sonner";
import { Icon } from "@/components/Icon";

/** Como o `#toast` antigo (static/style.css:471-475): pílula grafite com check + texto, ~2,2 s.
 *  Uso: `notify("Evento salvo")`. */
const bottom = "calc(24px + env(safe-area-inset-bottom))";

/** Como o original: sempre com o check, e um toast substitui o anterior. */
const notify = (text: string) => toast.success(text);

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="light"
      position="bottom-center"
      duration={2200}
      offset={{ bottom }}
      mobileOffset={{ bottom, left: 0, right: 0 }}
      visibleToasts={1}
      icons={{ success: <Icon name="check" /> }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "left-1/2! right-auto! w-max! max-w-[calc(100vw-32px)] -translate-x-1/2 flex items-center gap-2 rounded-foco bg-grafite px-4 py-[.7rem] font-sans text-t-sm text-papel",
          icon: "flex",
        },
      }}
      {...props}
    />
  );
}

export { notify, Toaster, toast };
