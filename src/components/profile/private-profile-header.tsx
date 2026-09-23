import type { ReactNode } from "react";
import Image from "next/image";
import { LockKeyhole } from "lucide-react";
import { currencyText } from "@/components/ui/currency-text";
import { cn } from "@/lib/utils";

/** The account holder's private header. Public profiles use AT identity only. */
export function PrivateProfileHeader({
  locale,
  fullName,
  publicId,
  avatarUrl,
  coverUrl,
  coverClassName,
  avatarClassName,
  nameClassName,
  coverActions,
  photoActions,
  children,
}: {
  locale: "en" | "ar";
  fullName: string;
  publicId: string;
  avatarUrl?: string;
  coverUrl?: string;
  coverClassName?: string;
  avatarClassName?: string;
  nameClassName?: string;
  coverActions?: ReactNode;
  photoActions?: ReactNode;
  children?: ReactNode;
}) {
  const isAr = locale === "ar";
  const name = fullName.trim() || publicId;

  return (
    <div data-private-profile-header>
      <div className={cn("relative h-36 border-b border-white/10 bg-gradient-to-r md:h-44", coverClassName)}>
        {coverUrl ? <Image src={coverUrl} alt={isAr ? "صورة الغلاف" : "Cover"} fill unoptimized className="object-cover opacity-90" /> : null}
        <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/75" />
        <div className="absolute end-3 top-3 flex flex-wrap gap-2">{coverActions}</div>
      </div>

      <div className="relative px-5 pb-5 md:px-8">
        <div className="flex items-start justify-between gap-3">
          <div className={cn("relative -mt-12 h-24 w-24 shrink-0 overflow-hidden rounded-2xl border bg-[#08090C]", avatarClassName)}>
            {avatarUrl ? (
              <Image src={avatarUrl} alt={isAr ? "الصورة الشخصية" : "Profile"} width={112} height={112} unoptimized className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-3xl font-semibold text-[#F4D87A]">{currencyText(name.charAt(0).toUpperCase())}</div>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap justify-end gap-2 pt-3">{photoActions}</div>
        </div>

        <div className="mt-4 min-w-0">
          <p className={cn("text-2xl font-semibold leading-tight text-white [overflow-wrap:anywhere] md:text-3xl", nameClassName)}>
            <bdi dir="auto">{currencyText(name)}</bdi>
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-xs leading-relaxed text-[#A6AFBE]">
            <LockKeyhole aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#8E9CAF]" />
            <span>{isAr ? "اسمك يبقى خاصًا بك." : "Your name stays private."}</span>
          </p>
          <div className="mt-3 inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2">
            <span className="text-xs text-[#A6AFBE]">{isAr ? "معرّف AT العام" : "Public AT ID"}</span>
            <bdi dir="ltr" className="whitespace-nowrap text-sm font-semibold tracking-wide text-[#DCE6F5]">{publicId}</bdi>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
