import { useCallback, useEffect, useRef, useState } from "react";

/** Câmera da selfie. getUserMedia exige HTTPS (ou localhost). static/app.js:815-843 */
export function useCamera() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const alive = useRef(true);
  const opening = useRef(false);

  const close = useCallback(() => {
    for (const t of streamRef.current?.getTracks() ?? []) t.stop();
    streamRef.current = null;
    setStream(null);
  }, []);

  // ref do <video>: liga o stream assim que o elemento monta
  const videoRef = useCallback((el: HTMLVideoElement | null) => {
    video.current = el;
    if (el) el.srcObject = streamRef.current;
  }, []);

  /** Abre a câmera. Falha com a mensagem pronta para mostrar. */
  const open = useCallback(async () => {
    if (streamRef.current || opening.current) return;
    opening.current = true;
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 960, facingMode: "user" },
      });
      if (!alive.current) {
        for (const t of s.getTracks()) t.stop();
        return;
      }
      streamRef.current = s;
      setStream(s);
    } catch (err) {
      const e = err as { name?: string; message?: string };
      throw new Error(
        `Não foi possível abrir a câmera. ${e.name === "NotAllowedError" ? "Permita o acesso no navegador." : e.message}`,
      );
    } finally {
      opening.current = false;
    }
  }, []);

  /** Quadro atual como JPEG (0,92). */
  const shoot = useCallback(() => {
    const v = video.current;
    if (!v) return Promise.reject(new Error("Câmera fechada."));
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    return new Promise<Blob>((resolve, reject) =>
      c.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Não foi possível tirar a foto."))),
        "image/jpeg",
        0.92,
      ),
    );
  }, []);

  // desmontou: para as tracks
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const t of streamRef.current?.getTracks() ?? []) t.stop();
      streamRef.current = null;
    };
  }, []);

  return { stream, videoRef, open, close, shoot };
}
