import { useState } from "react";
import { Icon } from "@/components/Icon";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSelfieSearch } from "./SelfieSearchProvider";
import { useCamera } from "./useCamera";
import { Viewfinder, type ViewfinderMode } from "./Viewfinder";

/** Bloco de busca: visor à esquerda, texto e ações à direita (no celular o visor fica
 *  ao lado do título e as ações ocupam a linha toda). static/index.html:148-177;
 *  static/app.js:796-843; static/style.css:214-231 e 662-672
 *  (sempre logo após a capa, então sem filete em cima e margem menor: style.css:201). */
export function SelfieFinder() {
  const { state, submitSelfie } = useSelfieSearch();
  const camera = useCamera();
  const [cameraError, setCameraError] = useState<string | null>(null);

  const mode: ViewfinderMode = camera.stream
    ? "cam"
    : !state.selfieUrl
      ? "empty"
      : state.status === "searching"
        ? "searching"
        : state.result
          ? "face"
          : "photo";

  const submit = (blob: Blob) => {
    camera.close();
    setCameraError(null);
    submitSelfie(blob);
  };
  const toggleCamera = async () => {
    setCameraError(null);
    if (camera.stream) return camera.close();
    try {
      await camera.open();
    } catch (e) {
      setCameraError((e as Error).message);
    }
  };
  const shoot = async () => {
    try {
      submit(await camera.shoot());
    } catch (e) {
      setCameraError((e as Error).message);
    }
  };

  const message = cameraError ? { text: cameraError, kind: "err" as const } : state.message;
  return (
    <div
      data-slot="finder"
      className="mt-2 grid grid-cols-[208px_minmax(0,560px)] items-center gap-10 border-linha border-b py-8 mobile:grid-cols-[104px_minmax(0,1fr)] mobile:items-start mobile:gap-[1.1rem] mobile:py-6"
    >
      <Viewfinder
        mode={mode}
        selfieUrl={state.selfieUrl}
        face={state.result?.selfie ?? null}
        videoRef={camera.videoRef}
      />
      <div className="mobile:contents">
        <h2 className="display text-t-xl mobile:col-start-2 mobile:row-start-1 mobile:self-end">
          Encontre suas fotos
        </h2>
        <p className="mt-[.6rem] max-w-[52ch] text-chumbo mobile:col-start-2 mobile:row-start-2 mobile:mt-0 mobile:self-start mobile:text-t-sm">
          Envie uma selfie de frente, com o rosto bem iluminado. Procuramos você em todas as fotos do evento.
        </p>
        <div className="mt-[1.4rem] flex flex-wrap gap-[.6rem] mobile:col-span-full mobile:mt-1">
          <label
            className={cn(
              buttonVariants({ variant: "primary" }),
              "has-focus-visible:outline-2 has-focus-visible:outline-viridian has-focus-visible:outline-offset-2 mobile:flex-1",
            )}
          >
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) submit(file);
                e.target.value = "";
              }}
            />
            <Icon name="upload" />
            Enviar selfie
          </label>
          <Button className="mobile:flex-1" onClick={toggleCamera}>
            <Icon name="camera" />
            <span>{camera.stream ? "Fechar câmera" : "Usar a câmera"}</span>
          </Button>
          {camera.stream && (
            <Button variant="primary" className="mobile:flex-1" onClick={shoot}>
              <Icon name="shutter" />
              Tirar foto
            </Button>
          )}
        </div>
        <p className="mt-[1.1rem] flex items-center gap-[.45rem] text-chumbo text-t-sm mobile:col-span-full mobile:mt-0">
          <Icon name="lock" className="size-4" />
          Sua selfie é usada só nesta busca e não fica salva.
        </p>
        <p
          role="status"
          className={cn(
            "mt-[.6rem] min-h-[1.3em] text-chumbo text-t-sm empty:hidden mobile:col-span-full mobile:mt-0",
            message.kind === "warn" && "text-grafite",
            message.kind === "err" && "text-erro",
          )}
        >
          {message.text}
        </p>
      </div>
    </div>
  );
}
