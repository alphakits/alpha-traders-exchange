"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Question = { message: string; input: boolean; initial: string };

/** In-page confirmations also work in the app WebView, where native prompts can be suppressed. */
export function useAdminActionDialog(isArabic: boolean) {
  const [question, setQuestion] = useState<Question | null>(null);
  const [value, setValue] = useState("");
  const pending = useRef<((answer: string | null) => void) | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const finish = useCallback((answer: string | null) => {
    const resolve = pending.current;
    pending.current = null;
    dialog.current?.close?.();
    setQuestion(null);
    resolve?.(answer);
    trigger.current?.focus();
  }, []);
  useEffect(() => () => {
    pending.current?.(null);
    pending.current = null;
  }, []);
  useEffect(() => {
    if (!question || !dialog.current) return;
    try { if (!dialog.current.open) dialog.current.showModal(); }
    catch { finish(null); }
  }, [question, finish]);
  const ask = useCallback((message: string, input: boolean, initial = "") => {
    if (pending.current) return Promise.resolve(null);
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setValue(initial);
    setQuestion({ message, input, initial });
    return new Promise<string | null>((resolve) => { pending.current = resolve; });
  }, []);
  const confirmAction = useCallback(async (message: string) => (await ask(message, false)) !== null, [ask]);
  const promptAction = useCallback((message: string, initial = "") => ask(message, true, initial), [ask]);
  const actionDialog = <dialog ref={dialog} aria-labelledby={`${id}-title`} dir={isArabic ? "rtl" : "ltr"}
    onCancel={(event) => { event.preventDefault(); finish(null); }}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl border border-amber-300/30 bg-[#101010] p-5 text-white backdrop:bg-black/80">
    {question ? <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); finish(question.input ? value : "confirmed"); }}>
      <h2 id={`${id}-title`} className="whitespace-pre-wrap text-base font-semibold">{question.message}</h2>
      {question.input ? <input aria-label={question.message} autoFocus value={value} onChange={(event) => setValue(event.target.value)}
        className="h-12 w-full rounded-xl border border-white/20 bg-black px-3" /> : null}
      <div className="flex gap-3">
        <Button type="button" variant="secondary" onClick={() => finish(null)}>{isArabic ? "إلغاء" : "Cancel"}</Button>
        <Button type="submit">{isArabic ? "تأكيد" : "Confirm"}</Button>
      </div>
    </form> : null}
  </dialog>;
  return { confirmAction, promptAction, actionDialog };
}
