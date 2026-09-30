import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label, Optional } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

test("Button primary e asChild em link", () => {
  render(
    <>
      <Button variant="primary">Criar</Button>
      <Button asChild>
        <a href="/x">Ir</a>
      </Button>
    </>,
  );
  expect(screen.getByRole("button", { name: "Criar" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ir" })).toHaveAttribute("href", "/x");
});

test("Slider responde ao teclado com passo 0,01", async () => {
  const onChange = vi.fn();
  render(
    <Slider aria-label="Precisão" min={0.15} max={0.8} step={0.01} value={[0.4]} onValueChange={onChange} />,
  );
  const thumb = screen.getByRole("slider");
  thumb.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(onChange).toHaveBeenCalledWith([0.41]);
});

test("Switch é um switch acessível", async () => {
  const onChange = vi.fn();
  render(<Switch aria-label="Calibração" checked={false} onCheckedChange={onChange} />);
  await userEvent.click(screen.getByRole("switch", { name: "Calibração" }));
  expect(onChange).toHaveBeenCalledWith(true);
});

test("Dialog abre com título e fecha no Escape", async () => {
  render(
    <Dialog>
      <DialogTrigger asChild>
        <Button>Abrir</Button>
      </DialogTrigger>
      <DialogContent variant="lightbox" aria-describedby={undefined}>
        <DialogTitle>Foto</DialogTitle>
      </DialogContent>
    </Dialog>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Abrir" }));
  expect(screen.getByRole("dialog", { name: "Foto" })).toHaveAttribute("data-variant", "lightbox");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("Select mostra só o nome no gatilho e escolhe pelo teclado", async () => {
  const onChange = vi.fn();
  render(
    <Select value="1" onValueChange={onChange}>
      <SelectTrigger label="Evento" aria-label="Evento" />
      <SelectContent>
        <SelectItem value="1" hint="12 fotos">
          Casamento
        </SelectItem>
        <SelectItem value="2" hint="3 fotos">
          Formatura
        </SelectItem>
      </SelectContent>
    </Select>,
  );
  const trigger = screen.getByRole("combobox");
  expect(trigger).toHaveTextContent("EventoCasamento");
  expect(trigger).not.toHaveTextContent("12 fotos");
  await userEvent.click(trigger);
  await userEvent.click(await screen.findByRole("option", { name: /Formatura/ }));
  expect(onChange).toHaveBeenCalledWith("2");
});

test("Input e Label formam um campo; Skeleton é decorativo", () => {
  render(
    <>
      <Label>
        Nome <Optional />
        <Input />
      </Label>
      <Skeleton className="h-4" />
    </>,
  );
  expect(screen.getByLabelText(/Nome/)).toHaveAttribute("type", "text");
  expect(screen.getByText("opcional").tagName).toBe("EM");
});
