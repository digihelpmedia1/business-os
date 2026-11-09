import { Pencil, Plus, UserCog } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/dates";
import { Badge, Card, PageHeader, Notice } from "@/components/ui/primitives";
import { FormDialog, type FieldDef } from "@/components/ui/form-dialog";
import { LinkButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { saveUser } from "@/server/actions/settings";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const me = await requirePageAccess("users");
  const [users, roles, employees] = await Promise.all([
    db.user.findMany({ include: { role: true, employee: { select: { id: true, name: true } } }, orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
    db.role.findMany({ orderBy: [{ isSystem: "desc" }, { name: "asc" }] }),
    db.employee.findMany({ where: { deletedAt: null, status: { not: "EXITED" } }, select: { id: true, name: true, userId: true }, orderBy: { name: "asc" } }),
  ]);
  const roleOptions = roles.map((r) => ({ value: r.id, label: `${r.name}${r.description ? ` — ${r.description}` : ""}` }));
  const fields = (forUserId: string | null): FieldDef[] => [
    { name: "name", label: "Full name", required: true },
    { name: "email", label: "Login email", type: "email", required: true },
    { name: "roleId", label: "Role (access level)", type: "select", options: roleOptions, required: true, span: 2, hint: "Edit what each role can see in Roles & Access Levels" },
    { name: "employeeId", label: "Linked employee profile", type: "select", options: employees.filter((e) => !e.userId || e.userId === forUserId).map((e) => ({ value: e.id, label: e.name })), hint: "Lets them see “My Work”, log time and request leave" },
    { name: "password", label: forUserId ? "Reset password (leave blank to keep)" : "Initial password", type: "password", required: !forUserId, hint: "Min 10 chars with a letter and a number" },
    { name: "mustChangePassword", label: "Ask to change password at next sign-in", type: "checkbox" },
    { name: "isActive", label: "Active (can sign in)", type: "checkbox" },
  ];
  const canEdit = can(me.access, "users", "FULL");
  return (
    <>
      <PageHeader
        title="Users"
        description="Everyone who can sign in. Each user gets one role; the role decides which modules they see and what they can change."
        actions={
          <>
            <LinkButton href="/settings/roles" variant="outline"><UserCog /> Roles & access levels</LinkButton>
            {canEdit ? <FormDialog trigger={<><Plus /> Invite user</>} title="Add user" description="Share the email and initial password with them privately. They can change it after signing in." fields={fields(null)} defaults={{ isActive: true, mustChangePassword: true, roleId: roles.find((r) => r.name === "Standard")?.id }} action={saveUser.bind(null, null)} size="lg" /> : null}
          </>
        }
      />
      <Notice className="mb-4">Changing a user's role, deactivating them or resetting their password signs them out of every device immediately.</Notice>
      <Card className="overflow-hidden">
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-b border-line bg-surface-2 text-left text-xs text-muted"><th className="px-4 py-2.5">User</th><th className="px-4 py-2.5">Role</th><th className="px-4 py-2.5">Employee profile</th><th className="px-4 py-2.5">Last sign-in</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5" /></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3"><span className="font-medium">{u.name}</span>{u.id === me.id ? <Badge tone="brand" className="ml-2">You</Badge> : null}<span className="block text-xs text-muted">{u.email}</span></td>
                  <td className="px-4 py-3"><Badge tone={u.role.isSystem ? "accent" : "info"}>{u.role.name}</Badge></td>
                  <td className="px-4 py-3 text-[13px]">{u.employee?.name ?? <span className="text-muted">—</span>}</td>
                  <td className="px-4 py-3 text-[13px] text-muted">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "Never"}{u.lockedUntil && u.lockedUntil > new Date() ? <Badge tone="danger" className="ml-1">Locked</Badge> : null}</td>
                  <td className="px-4 py-3"><StatusBadge status={u.isActive ? "ACTIVE" : "INACTIVE"} /></td>
                  <td className="px-4 py-3 text-right">
                    {canEdit ? <FormDialog trigger={<Pencil />} triggerVariant="ghost" triggerSize="icon-sm" title={`Edit ${u.name}`} fields={fields(u.id)} defaults={{ name: u.name, email: u.email, roleId: u.roleId, employeeId: u.employee?.id, isActive: u.isActive, mustChangePassword: u.mustChangePassword }} action={saveUser.bind(null, u.id)} size="lg" /> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
