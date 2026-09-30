import { type DragEvent, type KeyboardEvent, memo, useRef, useState } from "react";
import { Prints } from "@/components/Illustration";
import { useUploadActions } from "./UploadQueueProvider";

/** Área de soltar fotos. static/index.html:235-242; static/app.js:490-501; static/style.css:322-341 */
export const Dropzone = memo(function Dropzone({ eventId }: { eventId: number }) {
  const { addFiles } = useUploadActions();
  const onFiles = (files: File[]) => addFiles(eventId, files);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    onFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith("image/")));
  }
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.current?.click();
    }
  }
  return (
    <label
      // biome-ignore lint/a11y/noNoninteractiveTabindex: o label é o alvo focável do seletor de arquivos (igual ao original)
      tabIndex={0}
      data-over={over}
      className="mt-8 grid cursor-pointer grid-cols-[auto_1fr] grid-rows-[auto_auto] items-center gap-x-8 border border-linha bg-papel px-8 py-7 transition-[border-color,background-color] duration-150 hover:border-grafite data-[over=true]:border-viridian data-[over=true]:bg-viridian-tint mobile:grid-cols-1 mobile:p-5"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onKeyDown={onKeyDown}
    >
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      <Prints className="row-span-2 h-[99px] w-[132px] mobile:row-auto mobile:mb-2 mobile:h-[72px] mobile:w-24" />
      <span className="display self-end text-t-lg leading-[1.05]">
        <span className="touch:hidden">Arraste as fotos do evento para cá</span>
        <span className="hidden touch:inline">Escolher fotos do evento</span>
      </span>
      <span className="mt-[.35rem] self-start text-chumbo text-t-sm">
        <span className="touch:hidden">ou clique para escolher. </span>
        JPG, PNG ou WebP. Fotos repetidas são ignoradas.
      </span>
    </label>
  );
});
