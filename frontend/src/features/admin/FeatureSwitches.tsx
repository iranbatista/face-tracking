import { useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { useSetFeature } from "@/api/queries";
import type { FeatureInfo } from "@/api/types";
import { notify } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";

/** Um item por flag, com toggle otimista. static/app.js:1138-1175; static/style.css:592-613 */
export function FeatureSwitches({ flags, onExpired }: { flags: FeatureInfo[]; onExpired: () => void }) {
  const setFeature = useSetFeature();
  const busy = useRef(false); // guarda de ocupado (sem disabled, que faria o Chrome largar o foco do teclado)
  const [working, setWorking] = useState<string | null>(null);
  // estado mostrado enquanto a API não confirma (e depois dela); a recusa desfaz
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  function toggle(f: FeatureInfo, enabled: boolean) {
    if (busy.current) return;
    busy.current = true;
    setWorking(f.key);
    setErrors((s) => ({ ...s, [f.key]: "" }));
    setShown((s) => ({ ...s, [f.key]: enabled }));
    setFeature.mutate(
      { key: f.key, enabled },
      {
        onSuccess: () => notify(`${f.label}: ${enabled ? "ligada" : "desligada"}`),
        onError: (err) => {
          setShown((s) => ({ ...s, [f.key]: !enabled }));
          if (err instanceof ApiError && err.status === 401) onExpired();
          else setErrors((s) => ({ ...s, [f.key]: err.message }));
        },
        onSettled: () => {
          busy.current = false;
          setWorking(null);
        },
      },
    );
  }

  return (
    <ul className="mt-8 mb-5 max-w-[760px] list-none border-linha border-t p-0">
      {flags.map((f) => {
        const id = `flag-${f.key}`;
        return (
          <li
            key={f.key}
            className="flex items-center justify-between gap-6 border-linha border-b px-1 py-[1.1rem]"
          >
            <div>
              <label htmlFor={id} className="cursor-pointer font-medium text-t-md">
                {f.label}
              </label>
              <p id={`${id}-desc`} className="mt-[.2rem] max-w-[62ch] text-chumbo text-t-sm">
                {f.description}
              </p>
              {errors[f.key] && (
                <p role="alert" className="mt-[.6rem] text-erro text-t-sm">
                  {errors[f.key]}
                </p>
              )}
            </div>
            <Switch
              id={id}
              aria-describedby={`${id}-desc`}
              aria-busy={working === f.key ? true : undefined}
              checked={shown[f.key] ?? f.enabled}
              onCheckedChange={(v) => toggle(f, v)}
            />
          </li>
        );
      })}
    </ul>
  );
}
