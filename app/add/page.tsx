import { redirect } from "next/navigation";

// Bookmarklet target: /add?url=<job page> opens the "+ Applied" form on the dashboard with the link filled in.
export default async function Add({ searchParams }: { searchParams: Promise<{ url?: string | string[] }> }) {
  const { url } = await searchParams;
  const link = (Array.isArray(url) ? url[0] : url) ?? "";
  redirect(`/?add=${encodeURIComponent(link)}`);
}
