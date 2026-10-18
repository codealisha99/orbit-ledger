import AuthForm from "@/components/AuthForm";
import { hasSession } from "@/lib/server/session";
import { resolveDestination } from "@/lib/navigation";
import { redirect } from "next/navigation";
export default async function Signin({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await hasSession())
    redirect(resolveDestination((await searchParams).next));
  return <AuthForm />;
}
