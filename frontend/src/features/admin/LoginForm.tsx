import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { useLogin } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Login do backoffice. static/index.html:358-364; static/app.js:1112-1118 e 1167-1186 */
export function LoginForm({ notice, onLoggedIn }: { notice?: string; onLoggedIn: () => void }) {
  const pw = useRef<HTMLInputElement>(null);
  const login = useLogin();
  const [error, setError] = useState(notice ?? "");

  // entra com o foco na senha
  useEffect(() => pw.current?.focus(), []);
  // com erro, foco e seleção voltam à senha (digitar de novo substitui); limpar o erro no envio não conta
  useEffect(() => {
    if (!error) return;
    pw.current?.focus();
    pw.current?.select();
  }, [error]);

  function submit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    login.mutate(pw.current?.value ?? "", {
      onSuccess: () => {
        if (pw.current) pw.current.value = "";
        onLoggedIn();
      },
      // "Senha incorreta." vem da API
      onError: (err) =>
        setError(err instanceof ApiError && err.status === 404 ? "Backoffice desativado." : err.message),
    });
  }

  return (
    <form className="mt-8 grid max-w-[360px] gap-4" noValidate onSubmit={submit}>
      <Label>
        <span>Senha de admin</span>
        <Input ref={pw} type="password" autoComplete="current-password" required />
      </Label>
      <Button type="submit" variant="primary" className="justify-self-start" disabled={login.isPending}>
        Entrar
      </Button>
      {error && (
        <p role="alert" className="text-erro text-t-sm">
          {error}
        </p>
      )}
    </form>
  );
}
