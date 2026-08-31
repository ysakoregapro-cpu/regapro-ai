import { AccessDeniedView } from "@/components/platform/AccessDeniedView";

export const metadata = { title: "権限がありません" };

export default function ForbiddenPage() {
  return <AccessDeniedView />;
}
