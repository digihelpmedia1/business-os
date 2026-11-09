import Link from "next/link";
import { Lock, Plus, Trash2 } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { ACCESS_LEVELS, can, LEVEL_LABELS, MODULES, type Level } from "@/lib/permissions";
import { param, type SearchParams } from "@/lib/list";
import { Badge, Card, CardBody, CardHeader, Notice, PageHeader } from "@/components/ui/primitives";
import { InlineForm, SubmitButton } from "@/components/ui/form-dialog";
import { Input, Field } from "@/components/ui/fields";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { LinkButton } from "@/components/ui/button";
import { deleteRole, saveRole } from "@/server/actions/settings";
import { cn } from "@/lib/utils";

export const metadata = { title: "Roles & Access Levels" };

export default async function RolesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const me = await requirePageAccess("users");
  const sp = await searchParams;
  const roles = await db.role.findMany({ include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } }, orderBy: [{ isSystem: "desc" }, { name: "asc" }] });
  const creating = param(sp, "new") === "1";
  const selected = creating ? null : (roles.find((r) => r.id === param(sp, "role")) ?? roles.find((r) => !r.isSystem) ?? roles[0]);
  const levelOf = (moduleKey: string): Level => {
    if (!selected) return moduleKey === "projects" || moduleKey === "vault" ? "VIEW" : "NONE";
    if (selected.isSystem) return "FULL";
    return (selected.permissions.find((p) => p.permission.key === moduleKey)?.level as Level) ?? "NONE";
  };
  const canEdit = can(me.access, "users", "FULL");
  const locked = !!selected?.isSystem;
  return (
    <>
      <PageHeader
        title="Roles & Access Levels"
        description="Decide exactly what each team member sees. Assign roles to people in Users."
        actions={canEdit ? <LinkButton href="/settings/roles?new=1"><Plus /> New role</LinkButton> : null}
      />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card className="h-fit overflow-hidden">
          <ul className="divide-y divide-line">
            {roles.map((r) => (
              <li key={r.id}>
                <Link href={`/settings/roles?role=${r.id}`} className={cn("block px-4 py-3 hover:bg-surface-2", selected?.id === r.id && "bg-brand-soft/60")}>
                  <span className="flex items-center gap-2 text-sm font-medium">{r.name}{r.isSystem ? <Lock className="h-3.5 w-3.5 text-muted" /> : null}</span>
                  <span className="block text-xs text-muted">{r._count.users} user(s)</span>
                </Link>
              </li>
            ))}
            {creating ? <li className="bg-brand-soft/60 px-4 py-3 text-sm font-medium">New role</li> : null}
          </ul>
        </Card>
        <Card>
          <CardHeader
            title={creating ? "New role" : selected?.name ?? "Role"}
            description={locked ? "The Admin role always has full access to everything and can't be changed." : "Choose a level for each module. Levels build on each other."}
            action={!creating && selected && !selected.isSystem && canEdit ? <ConfirmAction action={deleteRole.bind(null, selected.id)} label={<><Trash2 /> Delete role</>} title={`Delete “${selected.name}”?`} message={selected._count.users ? "Move its users to another role first." : "This can't be undone."} confirmLabel="Delete" variant="danger-ghost" /> : null}
          />
          <InlineForm key={selected?.id ?? "new"} action={saveRole.bind(null, creating ? null : (selected?.id ?? null))} successMessage="Role saved">
            <fieldset disabled={!canEdit || locked}>
              <CardBody className="grid gap-4 border-b border-line sm:grid-cols-2">
                <Field label="Role name" required><Input name="name" defaultValue={creating ? "" : selected?.name} placeholder="e.g. Editor, Standard, Video Team" /></Field>
                <Field label="Description"><Input name="description" defaultValue={creating ? "" : (selected?.description ?? "")} placeholder="Who is this role for?" /></Field>
              </CardBody>
              <div className="thin-scroll overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-line bg-surface-2 text-xs text-muted">
                      <th className="px-4 py-2.5 text-left">Module</th>
                      {ACCESS_LEVELS.map((l) => <th key={l} className="px-3 py-2.5 text-center" title={LEVEL_LABELS[l].help}>{LEVEL_LABELS[l].label}<span className="block font-normal text-subtle">{LEVEL_LABELS[l].help}</span></th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {MODULES.map((m) => (
                      <tr key={m.key} className="border-b border-line last:border-0">
                        <td className="px-4 py-3"><span className="font-medium">{m.label}</span><span className="block text-xs text-muted">{m.description}</span></td>
                        {ACCESS_LEVELS.map((l) => (
                          <td key={l} className="px-3 py-3 text-center">
                            <input type="radio" name={`level_${m.key}`} value={l} defaultChecked={levelOf(m.key) === l} className="h-4 w-4 accent-[var(--brand)]" aria-label={`${m.label}: ${LEVEL_LABELS[l].label}`} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canEdit && !locked ? <div className="flex justify-end border-t border-line px-5 py-3"><SubmitButton>{creating ? "Create role" : "Save access levels"}</SubmitButton></div> : null}
            </fieldset>
          </InlineForm>
        </Card>
      </div>
      <Notice className="mt-4">
        <b>How levels work:</b> <Badge>No access</Badge> hides the module completely · <Badge tone="info">View</Badge> read-only · <Badge tone="brand">Edit</Badge> create & update ·
        <Badge tone="accent">Full</Badge> also delete, cancel, approve and configure. Team members linked to an employee profile can always see “My Work”, update their own tasks and log their own time.
      </Notice>
    </>
  );
}
