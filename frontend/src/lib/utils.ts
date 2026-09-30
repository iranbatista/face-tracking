import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Sem isto o tailwind-merge trata `text-t-sm` (escala do Foco) como cor e o descarta
// junto de `text-chumbo`, e não vê `rounded-foco` como raio.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["t-xs", "t-sm", "t-base", "t-md", "t-lg", "t-xl", "t-2xl"],
      radius: ["foco"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
