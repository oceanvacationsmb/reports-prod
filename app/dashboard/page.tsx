import { redirect } from "next/navigation";
import { DashboardApp } from "@/components/DashboardApp";
import { userFromCookies } from "@/lib/auth";

export default async function DashboardPage() {
  const user = await userFromCookies();
  if (!user) redirect("/login");
  return <DashboardApp user={user} />;
}
