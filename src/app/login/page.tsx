import { redirect } from "next/navigation";
import { getCurrentUser, homePathFor } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await getCurrentUser();
  if (user) redirect(homePathFor(user.access));
  const { next } = await searchParams;
  return (
    <div className="flex min-h-screen bg-bg">
      <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-[#0a1630] p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#005CFF] text-sm font-bold">DH</span>
          <span className="text-lg font-semibold">Digi Help Media</span>
        </div>
        <div>
          <h1 className="max-w-md text-4xl font-semibold leading-tight tracking-tight">
            One Platform.
            <br />
            <span className="text-[#F65000]">Complete Business Control.</span>
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/70">
            Billing, finance, projects, people and business intelligence for Digi Help Media — in one secure workspace.
          </p>
        </div>
        <p className="text-xs text-white/40">DHM Business OS · Internal use only</p>
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full border border-white/10" />
        <div className="pointer-events-none absolute -bottom-32 -right-10 h-96 w-96 rounded-full border border-white/5" />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white">DH</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-fg">Sign in to DHM Business OS</h2>
          <p className="mt-1.5 text-sm text-muted">Use the account created by your administrator.</p>
          <LoginForm next={next} />
        </div>
      </div>
    </div>
  );
}
