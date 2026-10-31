"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Question = { id: number; message: string; input: boolean };
type PendingQuestion = { id: number; resolve: (answer: string | null) => void };

/** Page-owned confirmations remain available when an embedded browser suppresses native prompts. */
export function useActionDialog(isArabic: boolean, scope?: string) {
  const [question, setQuestion] = useState<Question | null>(null);
  const [value, setValue] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const pending = useRef<PendingQuestion | null>(null);
  const nextQuestionId = useRef(0);
  const openedQuestionId = useRef<number | null>(null);
  const currentScope = useRef(scope);
  const mounted = useRef(true);
  const trigger = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();

  const finish = useCallback((answer: string | null, questionId?: number) => {
    const active = pending.current;
    if (!active || (questionId !== undefined && questionId !== active.id)) return;
    pending.current = null;
    openedQuestionId.current = null;
    const returnFocus = trigger.current;
    trigger.current = null;
    if (dialog.current?.open) dialog.current.close();
    if (mounted.current) setQuestion(null);
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    active.resolve(answer);
  }, []);

  useLayoutEffect(() => {
    // Pages can survive an account switch or lose access while a question is open.
    if (currentScope.current === scope) return;
    currentScope.current = scope;
    finish(null);
  }, [scope, finish]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const active = pending.current;
      pending.current = null;
      openedQuestionId.current = null;
      trigger.current = null;
      active?.resolve(null);
    };
  }, []);

  useEffect(() => {
    if (!question || !dialog.current) return;
    try {
      if (!dialog.current.open) dialog.current.showModal();
      openedQuestionId.current = question.id;
    } catch {
      finish(null, question.id);
      setDialogError(isArabic
        ? "تعذر فتح نافذة التأكيد. أعد تحميل الصفحة وحاول مجددًا. لم يتم تنفيذ أي إجراء."
        : "The confirmation could not open. Refresh the page and try again. No action was taken.");
    }
  }, [question, finish, isArabic]);

  const ask = useCallback((message: string, input: boolean, initial = "") => {
    // A second tap cannot replace a question or leave its caller waiting forever.
    if (!mounted.current || pending.current) return Promise.resolve(null);
    const questionId = ++nextQuestionId.current;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return new Promise<string | null>((resolve) => {
      pending.current = { id: questionId, resolve };
      setValue(initial);
      setDialogError(null);
      setQuestion({ id: questionId, message, input });
    });
  }, []);

  const confirmAction = useCallback(async (message: string) => (await ask(message, false)) !== null, [ask]);
  const promptAction = useCallback((message: string, initial = "") => ask(message, true, initial), [ask]);
  const actionDialog = <>
    {dialogError ? <p role="alert" className="rounded-xl border border-red-500/40 bg-red-950/50 p-3 text-sm text-red-100">{dialogError}</p> : null}
    <dialog ref={dialog} aria-labelledby={`${id}-title`} aria-modal="true" dir={isArabic ? "rtl" : "ltr"}
      data-testid="action-confirmation-dialog"
      onCancel={(event) => { event.preventDefault(); finish(null, question?.id); }}
      onClose={(event) => {
        // close events are queued by the browser. An event from a completed
        // question must not cancel the next question before its modal opens.
        if (!event.currentTarget.open && openedQuestionId.current !== null) finish(null, openedQuestionId.current);
      }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl border border-amber-300/30 bg-[#101010] p-5 text-white backdrop:bg-black/80">
      {question ? <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); finish(question.input ? value : "confirmed", question.id); }}>
        <h2 id={`${id}-title`} className="whitespace-pre-wrap text-base font-semibold">{question.message}</h2>
        {question.input ? <input aria-label={question.message} autoFocus value={value} onChange={(event) => setValue(event.target.value)}
          className="h-12 w-full rounded-xl border border-white/20 bg-black px-3" /> : null}
        <div className="flex gap-3">
          <Button type="button" variant="secondary" autoFocus={!question.input} onClick={() => finish(null, question.id)}>{isArabic ? "إلغاء" : "Cancel"}</Button>
          <Button type="submit">{isArabic ? "تأكيد" : "Confirm"}</Button>
        </div>
      </form> : null}
    </dialog>
  </>;

  return { confirmAction, promptAction, actionDialog, isActionDialogOpen: question !== null };
}
