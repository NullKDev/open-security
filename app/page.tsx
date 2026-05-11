import { redirect } from "next/navigation";

/** Root route — redirect to the remediation queue. */
export default function RootPage() {
  redirect("/queue");
}
