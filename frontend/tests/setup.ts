import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import "./msw";

// jsdom não tem estas APIs, que o Radix usa (Slider, Select, Dialog).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

// jsdom não tem URL.createObjectURL (a busca por selfie mostra a foto escolhida)
URL.createObjectURL = () => "blob:x"; // o do Node exige o Blob do Node, não o do jsdom
URL.revokeObjectURL = () => {};

// o router rola para o topo a cada navegação
window.scrollTo = () => {};

afterEach(() => cleanup());
