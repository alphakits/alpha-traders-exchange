import { notFound, redirect } from "next/navigation";
import { getCurrentSessionUserForAuthorization } from "@/lib/auth";
import { JournalWorkspace } from "@/components/journal/journal-workspace";
import { journalEnabled } from "@/lib/journal/feature";
export const dynamic = "force-dynamic";
export const metadata = { title: "Trading Journal | Alpha Traders", robots: { index:false,follow:false } };
export default async function JournalPage({params}:{params:Promise<{locale:string}>}) {
  if(!journalEnabled())notFound();
  const {locale}=await params;
  const user=await getCurrentSessionUserForAuthorization();
  if(!user||user.disabled)redirect(`/${locale}/login?redirectTo=/${locale}/journal`);
  return <JournalWorkspace key={user.id} locale={locale==="ar"?"ar":"en"}/>;
}
