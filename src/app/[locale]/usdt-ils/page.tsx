import { redirect } from "next/navigation";
export default async function UsdtIls({params}:{params:Promise<{locale:string}>}) {
  const {locale}=await params;
  redirect(`/${locale}/buy-usdt-israel`);
}
