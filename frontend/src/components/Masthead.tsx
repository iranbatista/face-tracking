import { Link, useLinkProps, useLocation } from "@tanstack/react-router";
import { useFeatures } from "@/api/queries";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/utils";

/** Cabeçalho: static/index.html:96-107 + static/style.css:127-155 (e o bloco mobile 614-729). */
const navLink =
  "border-b-[1.5px] border-transparent py-[.4rem] text-[.74rem] font-medium tracking-[.09em] text-chumbo uppercase no-underline hover:text-grafite mobile:flex-1 mobile:py-[.7rem] mobile:text-center aria-[current=page]:border-grafite aria-[current=page]:text-grafite";

export function Masthead() {
  const calibration = useFeatures().data?.calibration === true;
  const { pathname } = useLocation();
  // a marca não é um link "atual" (o Link forçaria aria-current na home): <a> simples com o href/click do router
  const { "aria-current": _current, ...brand } = useLinkProps({ to: "/" });
  // Galerias é a home e também `/galeria/:id`; o Link só marcaria "/" exato
  const galleries = pathname === "/" || pathname.startsWith("/galeria/");
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-10 border-linha border-b bg-[rgba(251,251,249,.94)] px-gutter backdrop-blur-[8px] backdrop-saturate-[1.2] mobile:relative mobile:h-auto mobile:flex-col mobile:items-stretch mobile:gap-2 mobile:bg-parede mobile:pt-[.9rem] mobile:pb-0 mobile:backdrop-filter-none">
      <a
        {...brand}
        href={brand.href}
        aria-label="Foco, todas as galerias"
        className="flex items-center gap-[.55rem] no-underline mobile:self-start"
      >
        <Icon name="mark" className="size-[22px]" />
        <span className="display text-[1.55rem] leading-none tracking-[.02em]">Foco</span>
      </a>
      <nav aria-label="Seções" className="flex gap-7 mobile:gap-0">
        <Link to="/" className={navLink} aria-current={galleries ? "page" : undefined} activeProps={{}}>
          Galerias
        </Link>
        <Link to="/estudio" className={navLink}>
          Estúdio
        </Link>
        {calibration && (
          <Link to="/calibracao" className={navLink}>
            Calibração
          </Link>
        )}
      </nav>
      <Link
        to="/backoffice"
        aria-label="Backoffice"
        title="Backoffice"
        className={cn(
          "ml-auto grid size-9 place-items-center rounded-full text-chumbo transition-[color] duration-150 hover:text-grafite aria-[current=page]:text-grafite",
          "mobile:absolute mobile:top-[.55rem] mobile:right-gutter mobile:m-0",
        )}
      >
        <Icon name="gear" className="size-5" />
      </Link>
    </header>
  );
}
