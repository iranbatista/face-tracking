/** Upload de UMA foto com progresso de envio. XMLHttpRequest (e não fetch)
 *  porque só ele reporta progresso de upload. Única exceção à regra "HTTP só
 *  pelo client.ts". */
import type { UploadResult } from "./types";

export type UploadFn = (
  eventId: number,
  file: File,
  onProgress: (sent: number) => void,
) => Promise<UploadResult>;

export const xhrUpload: UploadFn = (eventId, file, onProgress) =>
  new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("files", file);
    xhr.open("POST", `/api/events/${eventId}/photos`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status === 413) return resolve({ status: "error", error: "Arquivo grande demais" });
      try {
        resolve(
          xhr.status === 200
            ? ((JSON.parse(xhr.responseText) as UploadResult[])[0] ?? {
                status: "error",
                error: "Resposta vazia",
              })
            : { status: "error", error: `Erro ${xhr.status}` },
        );
      } catch {
        resolve({ status: "error", error: "Resposta inválida" });
      }
    };
    xhr.onerror = () => resolve({ status: "error", error: "Falha de conexão" });
    xhr.send(form);
  });
