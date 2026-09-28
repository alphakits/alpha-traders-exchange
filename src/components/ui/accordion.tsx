"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

type AccordionItem = {
  id: string;
  question: string;
  answer: string;
};

export function Accordion({ items }: { items: AccordionItem[] }) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const isActive = active === item.id;
        return (
          <div key={item.id} className="premium-card rounded-xl p-4">
            <button
              type="button"
              id={`accordion-trigger-${item.id}`}
              aria-expanded={isActive}
              aria-controls={`accordion-content-${item.id}`}
              className="flex w-full items-center justify-between gap-4 text-start"
              onClick={() => setActive(isActive ? null : item.id)}
            >
              <span className="font-medium text-white">{item.question}</span>
              <ChevronDown className={cn("h-4 w-4 text-[#9CA3AF] transition-transform", isActive && "rotate-180")} />
            </button>
            {isActive ? (
              <p id={`accordion-content-${item.id}`} role="region" aria-labelledby={`accordion-trigger-${item.id}`} className="mt-3 text-sm text-[#9CA3AF]">
                {item.answer}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
