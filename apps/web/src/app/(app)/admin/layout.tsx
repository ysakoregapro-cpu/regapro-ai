import { isPlatformAccessError } from "@regapro/platform";
import { AccessDeniedView } from "@/components/platform/AccessDeniedView";
import { requireModuleAccess } from "@/lib/platform/guards";
import { isSessionDenial } from "@/lib/platform/error-mapping";

/**
 * Security layer 2 for every `/admin/*` route.
 *
 * One guard at the layout instead of a check per page: typing an admin URL runs
 * exactly the predicate that decided whether the sidebar link was rendered.
 *
 * Only access refusals are turned into a page. Anything else — including the
 * dynamic-rendering bailout Next.js throws on `cookies()` — propagates, so a
 * real failure never masquerades as a permission problem and never gets
 * prerendered as one.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requireModuleAccess("admin");
  } catch (err) {
    if (isPlatformAccessError(err)) {
      return <AccessDeniedView code={err.code} />;
    }
    if (isSessionDenial(err)) {
      return <AccessDeniedView />;
    }
    throw err;
  }

  return <>{children}</>;
}
