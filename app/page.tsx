import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Dashboard from "@/components/Dashboard";
import type { CollectRun, CompanyRow, Job } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const owner = process.env.NEXT_PUBLIC_OWNER_EMAIL;
  if (owner && user.email !== owner) {
    return (
      <main style={{ padding: 32 }}>
        <p>This tracker is private. You&apos;re signed in as {user.email}.</p>
        <form action="/auth/signout" method="post"><button type="submit">Sign out</button></form>
      </main>
    );
  }

  const [{ data, error }, { data: companies }, { data: runs }] = await Promise.all([
    supabase.from("jobs").select("*").order("found_on", { ascending: false }).limit(2000),
    supabase.from("companies").select("*").order("name"),
    supabase.from("collect_runs").select("*").order("started_at", { ascending: false }).limit(1),
  ]);
  return (
    <Dashboard
      initialJobs={(data ?? []) as Job[]}
      loadError={error?.message ?? null}
      companies={(companies ?? []) as CompanyRow[]}
      lastRun={(runs?.[0] as CollectRun | undefined) ?? null}
    />
  );
}
