import { permanentRedirect } from "next/navigation";
export default async function UsdtIls({params}:{params:Promise<{locale:string}>}) {
  const {locale}=await params;
  permanentRedirect(`/${locale}/buy-usdt-israel`);
}
