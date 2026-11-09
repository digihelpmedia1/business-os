import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { LEVEL_LABELS, MODULES } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/dates";
import { Badge, Card, CardBody, CardHeader, Notice, PageHeader } from "@/components/ui/primitives";
import { FormFields, InlineForm, SubmitButton } from "@/components/ui/form-dialog";
import { changePassword, updateProfile } from "@/server/auth";

export const metadata = { title: "My profile" };

export default async function ProfilePage() {
  const me = await requireUser();
  const user = await db.user.findUniqueOrThrow({ where: { id: me.id } });
  const recent = await db.auditLog.findMany({ where: { userId: me.id, action: { in: ["LOGIN", "LOGIN_FAILED", "PASSWORD_CHANGE"] } }, orderBy: { createdAt: "desc" }, take: 8 });
  return (
    <>
      <PageHeader title="My profile" description={`${me.email} · ${me.roleName}`} />
      {me.mustChangePassword ? <Notice tone="warning" className="mb-4">Please set a new password before continuing.</Notice> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Profile" />
            <CardBody>
              <InlineForm action={updateProfile} successMessage="Profile updated">
                <FormFields fields={[{ name: "name", label: "Full name", required: true, span: 2 }]} defaults={{ name: user.name }} />
                <div className="mt-4 flex justify-end"><SubmitButton>Save</SubmitButton></div>
              </InlineForm>
            </CardBody>
          </Card>
          <Card id="password">
            <CardHeader title="Change password" description="Changing your password signs you out of other devices." />
            <CardBody>
              <InlineForm action={changePassword} resetOnSuccess successMessage="Password updated">
                <FormFields fields={[
                  { name: "current", label: "Current password", type: "password", required: true, span: 2 },
                  { name: "password", label: "New password", type: "password", required: true, hint: "At least 10 characters, with a letter and a number" },
                  { name: "confirm", label: "Confirm new password", type: "password", required: true },
                ]} />
                <div className="mt-4 flex justify-end"><SubmitButton>Update password</SubmitButton></div>
              </InlineForm>
            </CardBody>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="What I can access" description={`Role: ${me.roleName}`} />
            <ul className="divide-y divide-line">
              {MODULES.map((m) => (
                <li key={m.key} className="flex items-center justify-between px-5 py-2 text-[13px]">
                  <span>{m.label}</span>
                  <Badge tone={me.access[m.key] === "NONE" ? "neutral" : me.access[m.key] === "FULL" ? "accent" : me.access[m.key] === "EDIT" ? "brand" : "info"}>{LEVEL_LABELS[me.access[m.key]].label}</Badge>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Recent sign-in activity" />
            <ul className="divide-y divide-line">
              {recent.map((r) => <li key={r.id} className="flex justify-between px-5 py-2 text-[13px]"><span className={r.action === "LOGIN_FAILED" ? "text-danger" : ""}>{r.action === "LOGIN" ? "Signed in" : r.action === "LOGIN_FAILED" ? "Failed sign-in attempt" : "Password changed"}{r.ipAddress ? ` · ${r.ipAddress}` : ""}</span><span className="text-xs text-muted">{fmtDateTime(r.createdAt)}</span></li>)}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
