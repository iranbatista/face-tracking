import { cn } from "@/lib/utils";

/** Ilustrações do Foco (static/index.html:54-66 e 306-323). */

/** Pilha de cópias fotográficas (il-prints). */
export function Prints({ className }: { className?: string }) {
  return (
    <svg className={cn("illus", className)} viewBox="0 0 160 120" aria-hidden="true">
      <g fill="var(--color-papel)" stroke="var(--color-grafite)" strokeWidth="1.3" strokeLinejoin="round">
        <rect x="38" y="30" width="78" height="60" transform="rotate(-8 77 60)" />
        <rect x="44" y="26" width="78" height="60" transform="rotate(5 83 56)" />
        <rect x="40" y="30" width="80" height="62" />
      </g>
      <rect x="47" y="37" width="66" height="42" fill="var(--color-passe)" />
      <g fill="none" stroke="var(--color-grafite)" strokeWidth="1.3" strokeLinecap="round">
        <circle cx="80" cy="54" r="6.5" />
        <path d="M67 79c2.2-7.5 7-11.5 13-11.5s10.8 4 13 11.5" />
      </g>
      <path
        d="M70 49v-5h5M85 44h5v5M90 59v5h-5M75 64h-5v-5"
        fill="none"
        stroke="var(--color-viridian)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

const PERF_X = [20, 36, 52, 68, 84, 100, 116, 132];

/** Tira de contato com um quadro em foco. */
export function ContactStrip({ className }: { className?: string }) {
  return (
    <svg className={cn("illus", className)} viewBox="0 0 160 120" aria-hidden="true">
      <g fill="none" stroke="var(--color-grafite)" strokeWidth="1.3" strokeLinejoin="round">
        <rect x="14" y="38" width="132" height="44" fill="var(--color-papel)" />
        <rect x="22" y="46" width="30" height="28" fill="var(--color-passe)" stroke="none" />
        <rect x="65" y="46" width="30" height="28" fill="var(--color-passe)" stroke="none" />
        <rect x="108" y="46" width="30" height="28" fill="var(--color-passe)" stroke="none" />
      </g>
      <g fill="var(--color-grafite)">
        {[40.5, 77].flatMap((y) =>
          PERF_X.map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="4" height="2.5" />),
        )}
      </g>
      <path
        d="M72 55v-5h5M83 50h5v5M88 65v5h-5M77 70h-5v-5"
        fill="none"
        stroke="var(--color-viridian)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
