import { createFileRoute } from "@tanstack/react-router";
import { eventsQuery } from "@/api/queries";
import { RouteError, RoutePending } from "@/components/RouteStates";
import { GalleryIndex } from "@/features/gallery/GalleryIndex";
import { titles, useDocumentTitle } from "@/lib/title";

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(eventsQuery),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: Home,
});

function Home() {
  useDocumentTitle(titles.home);
  return <GalleryIndex />;
}
