import type { ReactNode, SVGProps } from "react";
import { cn } from "@/lib/utils";

/** Ícones do Foco: traço 1.5px, pontas arredondadas, grade de 24px.
 *  Portados de static/index.html:14-93 (cada <symbol>), com os mesmos atributos. */
export type IconName =
  | "mark"
  | "upload"
  | "download"
  | "camera"
  | "shutter"
  | "close"
  | "plus"
  | "lock"
  | "face"
  | "images"
  | "check"
  | "alert"
  | "copy"
  | "search"
  | "chev-l"
  | "chev-r"
  | "chev-d"
  | "edit"
  | "trash"
  | "eye"
  | "pin"
  | "gear";

const ICONS: Record<IconName, { props: SVGProps<SVGSVGElement>; body: ReactNode }> = {
  mark: {
    props: { fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round" },
    body: (
      <>
        <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" />
        <circle cx="12" cy="12" r="1.7" fill="var(--color-viridian)" stroke="none" />
      </>
    ),
  },
  upload: {
    props: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.5",
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: (
      <>
        <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15M12 15V4M7.5 8.5 12 4l4.5 4.5" />
      </>
    ),
  },
  download: {
    props: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.5",
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: (
      <>
        <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15M12 4v11M7.5 10.5 12 15l4.5-4.5" />
      </>
    ),
  },
  camera: {
    props: { fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinejoin: "round" },
    body: (
      <>
        <path d="M3.5 8.5A1.5 1.5 0 0 1 5 7h2.6l1.5-2.2h5.8L16.4 7H19a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" />
        <circle cx="12" cy="12.8" r="3.4" />
      </>
    ),
  },
  shutter: {
    props: { fill: "none", stroke: "currentColor", strokeWidth: "1.5" },
    body: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <circle cx="12" cy="12" r="5.5" fill="currentColor" stroke="none" />
      </>
    ),
  },
  close: {
    props: { fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" },
    body: (
      <>
        <path d="M6 6l12 12M18 6 6 18" />
      </>
    ),
  },
  plus: {
    props: { fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" },
    body: (
      <>
        <path d="M12 5v14M5 12h14" />
      </>
    ),
  },
  lock: {
    props: { fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinejoin: "round" },
    body: (
      <>
        <rect x="5" y="10.5" width="14" height="9.5" rx="1.5" />
        <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" strokeLinecap="round" />
      </>
    ),
  },
  face: {
    props: { fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" },
    body: (
      <>
        <circle cx="12" cy="9" r="3.8" />
        <path d="M4.8 19.5c1.3-3.2 4-4.8 7.2-4.8s5.9 1.6 7.2 4.8" />
      </>
    ),
  },
  images: {
    props: { fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinejoin: "round" },
    body: (
      <>
        <rect x="3.5" y="5.5" width="17" height="13" rx="1" />
        <path d="m3.5 15.5 4.5-4 3.5 3 3-2.5 6 4.5" strokeLinecap="round" />
        <circle cx="15.5" cy="9.5" r="1.3" />
      </>
    ),
  },
  check: {
    props: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.6",
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: (
      <>
        <path d="m5 12.5 4.5 4.5L19 7.5" />
      </>
    ),
  },
  alert: {
    props: { fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" },
    body: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5v5.5M12 16.2v.1" />
      </>
    ),
  },
  copy: {
    props: { fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinejoin: "round" },
    body: (
      <>
        <rect x="8.5" y="8.5" width="11" height="11" rx="1.2" />
        <path d="M15.5 8.5V5.7a1.2 1.2 0 0 0-1.2-1.2H5.7a1.2 1.2 0 0 0-1.2 1.2v8.6a1.2 1.2 0 0 0 1.2 1.2h2.8" />
      </>
    ),
  },
  search: {
    props: { fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" },
    body: (
      <>
        <circle cx="10.5" cy="10.5" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
  },
  "chev-l": {
    props: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.5",
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: (
      <>
        <path d="m14.5 6-6 6 6 6" />
      </>
    ),
  },
  "chev-r": {
    props: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.5",
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: (
      <>
        <path d="m9.5 6 6 6-6 6" />
      </>
    ),
  },
  "chev-d": {
    props: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.5",
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: (
      <>
        <path d="m6 9.5 6 6 6-6" />
      </>
    ),
  },
  edit: {
    props: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.5",
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: (
      <>
        <path d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-3-3l-10 10z" />
        <path d="m14 8 2 2" />
      </>
    ),
  },
  trash: {
    props: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.5",
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: (
      <>
        <path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
      </>
    ),
  },
  eye: {
    props: { fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinejoin: "round" },
    body: (
      <>
        <path d="M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12z" />
        <circle cx="12" cy="12" r="2.8" />
      </>
    ),
  },
  pin: {
    props: { fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinejoin: "round" },
    body: (
      <>
        <path d="M12 20.5s6-5.4 6-10.5a6 6 0 0 0-12 0c0 5.1 6 10.5 6 10.5z" />
        <circle cx="12" cy="10" r="2.2" />
      </>
    ),
  },
  gear: {
    props: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.5",
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: (
      <>
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  const { props, body } = ICONS[name];
  return (
    <svg className={cn("ico", className)} aria-hidden="true" viewBox="0 0 24 24" {...props}>
      {body}
    </svg>
  );
}
