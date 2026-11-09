import { ShieldAlert } from "lucide-react";
import { Card, EmptyState } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/button";
import { MODULES } from "@/lib/permissions";

export const metadata = { title: "No access" };

export default async function NoAccess({ searchParams }: { searchParams: Promise<{ module?: string }> }) {
  const { module } = await searchParams;
  const label = MODULES.find((m) => m.key === module)?.label ?? "this page";
  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <EmptyState
        icon={<ShieldAlert />}
        title="You don't have access"
        description={`Your role doesn't include access to ${label}. Ask an administrator to change your access level in Users & Access → Roles.`}
        action={<LinkButton href="/" variant="outline">Go to my home page</LinkButton>}
      />
    </Card>
  );
}
