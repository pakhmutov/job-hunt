import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Dashboard from "@/components/Dashboard";
import { REPLIED, type CollectRun, type CompanyRow, type Job, type ReplyEvent } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ add?: string | string[] }> }) {
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

  const { add } = await searchParams;
  const [{ data, error }, { data: companies }, { data: runs }, { data: events }] = await Promise.all([
    supabase.from("jobs").select("*").order("found_on", { ascending: false }).limit(2000),
    supabase.from("companies").select("*").order("name"),
    supabase.from("collect_runs").select("*").order("started_at", { ascending: false }).limit(1),
    // Real status changes into a reply stage, for "average days until the first reply".
    supabase.from("job_events").select("job_id, to_status, at").not("from_status", "is", null).in("to_status", [...REPLIED]).limit(5000),
  ]);
  return (
    <Dashboard
      initialJobs={(data ?? []) as Job[]}
      loadError={error?.message ?? null}
      companies={(companies ?? []) as CompanyRow[]}
      lastRun={(runs?.[0] as CollectRun | undefined) ?? null}
      replyEvents={(events ?? []) as ReplyEvent[]}
      addUrl={typeof add === "string" ? add : Array.isArray(add) ? add[0] ?? "" : null}
    />
  );
}
