import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "@/api/client";
import { qk, useAdminFeatures, useAdminSession, useLogout } from "@/api/queries";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/button";
import { FeatureSwitches } from "./FeatureSwitches";
import { LoginForm } from "./LoginForm";

const note = "mt-8 max-w-[52ch] text-chumbo";

/** Um dos quatro estados da tela: carregando (nada), off (sem ADMIN_PASSWORD), fail, login ou panel.
 *  static/app.js:1099-1136 */
export function Backoffice() {
  const qc = useQueryClient();
  const session = useAdminSession();
  const s = session.data;
  const panel = !!s?.enabled && s.logged_in;
  const flags = useAdminFeatures(panel);
  const logout = useLogout();
  const [notice, setNotice] = useState("");

  const toLogin = (msg: string) => {
    setNotice(msg);
    qc.setQueryData(qk.adminSession, { enabled: true, logged_in: false });
  };

  let body = null;
  if (session.isError) body = <p className={note}>Não foi possível falar com o servidor. Tente de novo.</p>;
  else if (s && !s.enabled)
    body = (
      <p className={note}>
        Backoffice desativado: defina{" "}
        <code className="rounded-[4px] bg-passe px-[.35rem] py-[.1rem] text-t-sm">ADMIN_PASSWORD</code> no
        servidor e reinicie.
      </p>
    );
  else if (s && !s.logged_in)
    body = <LoginForm key={notice} notice={notice} onLoggedIn={() => setNotice("")} />;
  else if (flags.isError) {
    const err = flags.error;
    body = (
      <LoginForm
        key="err"
        notice={err instanceof ApiError && err.status === 401 ? "" : err.message}
        onLoggedIn={() => setNotice("")}
      />
    );
  } else if (flags.data)
    body = (
      <div>
        <FeatureSwitches flags={flags.data} onExpired={() => toLogin("Sessão expirada. Entre de novo.")} />
        <Button variant="text" onClick={() => logout.mutate()}>
          <Icon name="close" />
          Sair
        </Button>
      </div>
    );

  return (
    <section aria-labelledby="a-title">
      <header className="pt-11 mobile:pt-7">
        <h1 id="a-title" className="display text-t-xl">
          Backoffice
        </h1>
        <p className="mt-[.7rem] max-w-[66ch] text-chumbo">
          Ligue e desligue funcionalidades do Foco para todos os visitantes. Vale na hora, sem novo deploy.
        </p>
      </header>
      {body}
    </section>
  );
}
