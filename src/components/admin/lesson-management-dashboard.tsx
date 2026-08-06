"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AlertCircle, CheckCircle2, Download, FileUp, GripVertical, Loader2, Plus, Save, Search, Trash2, Upload } from "lucide-react";
import { useLocale } from "next-intl";
import type { Lesson, LessonCategory, LessonStatus, QuizQuestion, UserRole, VideoProvider } from "@/types/academy";
import type { AdminAnalytics, LessonVersion, MediaItem } from "@/types/admin";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type BootstrapPayload = {
  lessons: Lesson[];
  courses: Array<{ id: string; title: string; titleAr: string; level: string }>;
  media: MediaItem[];
  versions: LessonVersion[];
  analytics: AdminAnalytics;
};

const pageSize = 10;

function mapCategoryToCourse(category: LessonCategory, courses: BootstrapPayload["courses"]) {
  const fallback = courses[0]?.id || "c1";
  if (category === "beginner") {
    return courses.find((course) => course.level === "beginner")?.id || fallback;
  }
  if (category === "intermediate") {
    return courses.find((course) => course.level === "intermediate" || course.level === "risk-management")?.id || fallback;
  }
  return courses.find((course) => course.level === "advanced" || course.level === "ict" || course.level === "psychology")?.id || fallback;
}

export function LessonManagementDashboard() {
  const locale = useLocale();
  const isAr = locale === "ar";
  const [role, setRole] = useState<UserRole>("admin");
  const [adminKey, setAdminKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [versions, setVersions] = useState<LessonVersion[]>([]);
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [courses, setCourses] = useState<BootstrapPayload["courses"]>([]);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<LessonCategory | "all">("all");
  const [statusFilter, setStatusFilter] = useState<LessonStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState<string>("");
  const [dragLessonId, setDragLessonId] = useState<string | null>(null);
  const autosaveRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const selectedLesson = useMemo(() => lessons.find((lesson) => lesson.id === selectedLessonId) || null, [lessons, selectedLessonId]);

  const filteredLessons = useMemo(() => {
    const term = query.trim().toLowerCase();
    return lessons.filter((lesson) => {
      if (categoryFilter !== "all" && lesson.category !== categoryFilter) return false;
      if (statusFilter !== "all" && (lesson.status || "published") !== statusFilter) return false;
      if (!term) return true;
      const haystack = `${lesson.title} ${lesson.slug} ${lesson.lessonNumber || lesson.order} ${lesson.description}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [categoryFilter, lessons, query, statusFilter]);

  const paginatedLessons = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredLessons.slice(start, start + pageSize);
  }, [filteredLessons, page]);

  const totalPages = Math.max(1, Math.ceil(filteredLessons.length / pageSize));

  const authHeaders = useCallback(() => {
    const headers: Record<string, string> = {
      "x-admin-role": role,
      "x-admin-actor": "dashboard-user",
    };
    if (adminKey.trim()) {
      headers["x-admin-key"] = adminKey.trim();
    }
    return headers;
  }, [adminKey, role]);

  const fetchBootstrap = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/admin/bootstrap", {
      headers: authHeaders(),
      cache: "no-store",
    });
    const payload = (await response.json()) as BootstrapPayload & { error?: string };
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load admin data.");
    }
    setLessons(payload.lessons);
    setMedia(payload.media);
    setVersions(payload.versions);
    setAnalytics(payload.analytics);
    setCourses(payload.courses);
    setSelectedLessonId((current) => current || payload.lessons[0]?.id || null);
    setLoading(false);
  }, [authHeaders]);

  useEffect(() => {
    void fetchBootstrap().catch((error) => {
      setToast(error instanceof Error ? error.message : "Failed to load.");
      setLoading(false);
    });
  }, [fetchBootstrap]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!importInputRef.current) return;
    importInputRef.current.setAttribute("webkitdirectory", "");
    importInputRef.current.setAttribute("directory", "");
  }, []);

  function patchSelectedLesson(patch: Partial<Lesson>) {
    if (!selectedLessonId) return;
    setLessons((current) =>
      current.map((lesson) => {
        if (lesson.id !== selectedLessonId) return lesson;
        return {
          ...lesson,
          ...patch,
          assets: {
            ...lesson.assets,
            ...(patch.assets || {}),
          },
        };
      }),
    );
    setDirty(true);
  }

  const persistLesson = useCallback(async (nextLesson: Lesson) => {
    setSaving(true);
    const response = await fetch(`/api/admin/lessons/${nextLesson.id}`, {
      method: "PUT",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify({ lesson: nextLesson }),
    });
    const payload = (await response.json()) as { lesson?: Lesson; error?: string };
    if (!response.ok || !payload.lesson) {
      setSaving(false);
      throw new Error(payload.error || "Failed to save lesson.");
    }
    setLessons((current) => current.map((lesson) => (lesson.id === payload.lesson!.id ? payload.lesson! : lesson)));
    setSaving(false);
    setDirty(false);
    setToast(isAr ? "✓ تم الحفظ تلقائياً" : "✓ Saved");
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 1600);
  }, [authHeaders, isAr]);

  useEffect(() => {
    if (!selectedLesson || !dirty) return;
    if (autosaveRef.current) {
      window.clearTimeout(autosaveRef.current);
    }
    autosaveRef.current = window.setTimeout(() => {
      void persistLesson(selectedLesson).catch((error) => {
        setToast(error instanceof Error ? error.message : "Save failed.");
      });
    }, 900);
    return () => {
      if (autosaveRef.current) {
        window.clearTimeout(autosaveRef.current);
      }
    };
  }, [dirty, persistLesson, selectedLesson]);

  async function createNewLesson() {
    const category: LessonCategory = "beginner";
    const response = await fetch("/api/admin/lessons", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        lesson: {
          title: isAr ? "درس جديد" : "New Lesson",
          slug: `new-lesson-${Date.now()}`,
          courseId: mapCategoryToCourse(category, courses),
          category,
          status: "draft",
          description: "",
          summary: "",
          durationMinutes: 20,
        },
      }),
    });
    const payload = (await response.json()) as { lesson?: Lesson; error?: string };
    if (!response.ok || !payload.lesson) {
      setToast(payload.error || "Failed to create lesson.");
      return;
    }
    setLessons((current) => [...current, payload.lesson!]);
    setSelectedLessonId(payload.lesson.id);
    setToast(isAr ? "تم إنشاء الدرس." : "Lesson created.");
  }

  async function handleDeleteLesson(lessonId: string) {
    if (!confirm(isAr ? "حذف هذا الدرس؟" : "Delete this lesson?")) return;
    const response = await fetch(`/api/admin/lessons/${lessonId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setToast(payload.error || "Delete failed.");
      return;
    }
    setLessons((current) => current.filter((lesson) => lesson.id !== lessonId));
    if (selectedLessonId === lessonId) {
      setSelectedLessonId((current) => (current === lessonId ? null : current));
    }
  }

  async function duplicateSelectedLesson() {
    if (!selectedLesson) return;
    const response = await fetch(`/api/admin/lessons/${selectedLesson.id}/duplicate`, {
      method: "POST",
      headers: authHeaders(),
    });
    const payload = (await response.json()) as { lesson?: Lesson; error?: string };
    if (!response.ok || !payload.lesson) {
      setToast(payload.error || "Duplicate failed.");
      return;
    }
    setLessons((current) => [...current, payload.lesson!]);
    setSelectedLessonId(payload.lesson.id);
  }

  async function setPublishState(status: LessonStatus) {
    if (!selectedLesson) return;
    const response = await fetch(`/api/admin/lessons/${selectedLesson.id}`, {
      method: "PUT",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify({ lesson: { status } }),
    });
    const payload = (await response.json()) as { lesson?: Lesson; error?: string };
    if (!response.ok || !payload.lesson) {
      setToast(payload.error || "Publish update failed.");
      return;
    }
    setLessons((current) => current.map((lesson) => (lesson.id === payload.lesson!.id ? payload.lesson! : lesson)));
  }

  async function saveReorder(nextLessons: Lesson[]) {
    setLessons(nextLessons);
    const response = await fetch("/api/admin/lessons/reorder", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        items: nextLessons.map((lesson, index) => ({
          id: lesson.id,
          order: index + 1,
          category: lesson.category,
          courseId: lesson.courseId,
        })),
      }),
    });
    const payload = (await response.json()) as { lessons?: Lesson[]; error?: string };
    if (!response.ok || !payload.lessons) {
      setToast(payload.error || "Reorder failed.");
      return;
    }
    setLessons(payload.lessons);
  }

  function handleDropOnLesson(targetLesson: Lesson) {
    if (!dragLessonId || dragLessonId === targetLesson.id) return;
    const sourceIndex = lessons.findIndex((lesson) => lesson.id === dragLessonId);
    const targetIndex = lessons.findIndex((lesson) => lesson.id === targetLesson.id);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const reordered = [...lessons];
    const [moved] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    const normalized = reordered.map((lesson, index) => ({
      ...lesson,
      order: index + 1,
      lessonNumber: index + 1,
    }));
    void saveReorder(normalized);
    setDragLessonId(null);
  }

  function handleMoveToCategory(lessonId: string, category: LessonCategory) {
    const next = lessons.map((lesson) => {
      if (lesson.id !== lessonId) return lesson;
      return {
        ...lesson,
        category,
        courseId: mapCategoryToCourse(category, courses),
      };
    });
    const normalized = next.map((lesson, index) => ({ ...lesson, order: index + 1, lessonNumber: index + 1 }));
    void saveReorder(normalized);
  }

  async function uploadMedia(file: File, lessonId: string, target: "thumbnail" | "video" | "pdf") {
    const formData = new FormData();
    formData.set("file", file);
    formData.set("lessonId", lessonId);
    formData.set("provider", "supabase");
    const response = await fetch("/api/admin/media", {
      method: "POST",
      headers: authHeaders(),
      body: formData,
    });
    const payload = (await response.json()) as { media?: MediaItem; error?: string };
    if (!response.ok || !payload.media) {
      setToast(payload.error || "Upload failed.");
      return;
    }

    setMedia((current) => [payload.media!, ...current]);
    if (!selectedLesson) return;
    if (target === "thumbnail") {
      patchSelectedLesson({ thumbnail: payload.media.url });
    } else if (target === "video") {
      patchSelectedLesson({
        assets: {
          ...selectedLesson.assets,
          videoProvider: "self-hosted",
          videoUrl: payload.media.url,
          videoId: "",
        },
      });
    } else {
      patchSelectedLesson({
        assets: {
          ...selectedLesson.assets,
          pdfProvider: "supabase",
          pdfUrl: payload.media.url,
          pdfFileId: "",
        },
      });
    }
  }

  async function runImport(files: FileList) {
    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append("files", file));
    const response = await fetch("/api/admin/import", {
      method: "POST",
      headers: authHeaders(),
      body: formData,
    });
    const payload = (await response.json()) as { created?: number; lessons?: Lesson[]; error?: string };
    if (!response.ok || !payload.lessons) {
      setToast(payload.error || "Import failed.");
      return;
    }
    setLessons((current) => [...current, ...payload.lessons!]);
    setToast(isAr ? `تم استيراد ${payload.created ?? payload.lessons.length} درس.` : `Imported ${payload.created ?? payload.lessons.length} lessons.`);
  }

  function addQuizQuestion(type: "multiple-choice" | "true-false") {
    if (!selectedLesson) return;
    const index = selectedLesson.quiz.length + 1;
    const newQuestion: QuizQuestion = {
      id: `q-${Date.now()}-${index}`,
      type,
      question: "",
      questionAr: "",
      options: type === "true-false" ? ["True", "False"] : ["", "", "", ""],
      optionsAr: type === "true-false" ? ["صحيح", "خطأ"] : ["", "", "", ""],
      correctIndex: 0,
      explanation: "",
      explanationAr: "",
    };
    patchSelectedLesson({ quiz: [...selectedLesson.quiz, newQuestion] });
  }

  if (loading) {
    return (
      <section className="section-container page-shell">
        <div className="flex items-center gap-2 text-sm text-[#9CA3AF]">
          <Loader2 className="h-4 w-4 animate-spin" />
          {isAr ? "جاري تحميل لوحة الإدارة..." : "Loading admin dashboard..."}
        </div>
      </section>
    );
  }

  return (
    <section className="section-container page-shell">
      <h1 className="page-title">{isAr ? "لوحة الإدارة" : "Admin Dashboard"}</h1>
      <p className="page-subtitle">{isAr ? "إدارة كاملة للدروس والوسائط والاختبارات بدون تعديل ملفات JSON يدوياً." : "Full lesson/media/quiz management without manual JSON editing."}</p>

      <Card className="mt-6">
        <CardContent className="pt-6">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-[#9CA3AF]">{isAr ? "الدور" : "Role"}</label>
              <select value={role} onChange={(event) => setRole(event.target.value as UserRole)} className="h-11 w-full rounded-xl border border-white/15 bg-[#101010] px-3 text-sm">
                <option value="admin">Admin</option>
                <option value="editor">Editor</option>
                <option value="instructor">Instructor</option>
                <option value="student">Student</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs text-[#9CA3AF]">{isAr ? "مفتاح الإدارة (اختياري)" : "Admin key (optional)"}</label>
              <Input value={adminKey} onChange={(event) => setAdminKey(event.target.value)} placeholder={isAr ? "ADMIN_ACCESS_KEY" : "ADMIN_ACCESS_KEY"} />
            </div>
          </div>
        </CardContent>
      </Card>

      {analytics ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card><CardContent className="pt-6"><p className="text-xs text-[#9CA3AF]">{isAr ? "إجمالي الدروس" : "Total Lessons"}</p><p className="mt-2 text-2xl font-semibold">{analytics.totalLessons}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-xs text-[#9CA3AF]">{isAr ? "المنشور" : "Published"}</p><p className="mt-2 text-2xl font-semibold">{analytics.publishedLessons}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-xs text-[#9CA3AF]">{isAr ? "المسودات" : "Drafts"}</p><p className="mt-2 text-2xl font-semibold">{analytics.draftLessons}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-xs text-[#9CA3AF]">{isAr ? "متوسط التقدم" : "Average Progress"}</p><p className="mt-2 text-2xl font-semibold">{analytics.averageProgress}%</p></CardContent></Card>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 xl:grid-cols-[360px_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-lg">{isAr ? "إدارة الدروس" : "Lesson Management"}</CardTitle>
            <CardDescription>{isAr ? "بحث، فلترة، سحب وإفلات، نشر." : "Search, filter, drag & drop, publish."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
              <Input className="ps-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={isAr ? "بحث بالعنوان/الرقم" : "Search by title/number"} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as LessonCategory | "all")} className="h-11 rounded-xl border border-white/15 bg-[#101010] px-3 text-sm">
                <option value="all">{isAr ? "كل الفئات" : "All Categories"}</option>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as LessonStatus | "all")} className="h-11 rounded-xl border border-white/15 bg-[#101010] px-3 text-sm">
                <option value="all">{isAr ? "الكل" : "All Status"}</option>
                <option value="published">{isAr ? "منشور" : "Published"}</option>
                <option value="draft">{isAr ? "مسودة" : "Draft"}</option>
              </select>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={createNewLesson}><Plus className="h-4 w-4" />{isAr ? "درس جديد" : "Create"}</Button>
              <Button size="sm" variant="secondary" onClick={duplicateSelectedLesson}>{isAr ? "نسخ" : "Duplicate"}</Button>
            </div>

            <div className="space-y-2">
              {paginatedLessons.map((lesson) => (
                <div
                  key={lesson.id}
                  draggable
                  onDragStart={() => setDragLessonId(lesson.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => handleDropOnLesson(lesson)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                    selectedLessonId === lesson.id ? "border-[#C9A227]/50 bg-[#C9A227]/10" : "border-white/10"
                  }`}
                >
                  <GripVertical className="h-4 w-4 text-[#9CA3AF]" />
                  <button type="button" className="min-w-0 flex-1 text-start" onClick={() => setSelectedLessonId(lesson.id)}>
                    <p className="truncate">{lesson.lessonNumber || lesson.order}. {isAr ? lesson.titleAr : lesson.title}</p>
                    <p className="text-xs text-[#9CA3AF]">{lesson.category} · {lesson.status || "published"}</p>
                  </button>
                  <button type="button" onClick={() => handleDeleteLesson(lesson.id)} aria-label="delete lesson">
                    <Trash2 className="h-4 w-4 text-[#9CA3AF] hover:text-red-300" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between text-xs text-[#9CA3AF]">
              <span>{filteredLessons.length} {isAr ? "درس" : "lessons"}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Prev</Button>
                <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</Button>
              </div>
            </div>

            <div className="space-y-2 rounded-xl border border-white/10 p-3 text-xs">
              <p className="text-[#9CA3AF]">{isAr ? "منظم الدورات (سحب بين الأقسام)" : "Course Organizer (move between sections)"}</p>
              <div className="grid grid-cols-3 gap-1">
                {(["beginner", "intermediate", "advanced"] as LessonCategory[]).map((category) => (
                  <div
                    key={category}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (dragLessonId) handleMoveToCategory(dragLessonId, category);
                    }}
                    className="rounded-lg border border-dashed border-white/20 px-2 py-3 text-center"
                  >
                    {category}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {selectedLesson ? (
            <>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-lg">{isAr ? "تفاصيل الدرس" : "Lesson Details"}</CardTitle>
                      <CardDescription>{dirty ? (isAr ? "توجد تغييرات غير محفوظة" : "Unsaved changes") : saving ? (isAr ? "جاري الحفظ..." : "Auto saving...") : isAr ? "✓ محفوظ" : "✓ Saved"}</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setPublishState("draft")}>{isAr ? "إلغاء النشر" : "Unpublish"}</Button>
                      <Button size="sm" onClick={() => setPublishState("published")}>{isAr ? "نشر" : "Publish"}</Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input value={selectedLesson.title} onChange={(event) => patchSelectedLesson({ title: event.target.value })} placeholder="Lesson Title" />
                    <Input value={selectedLesson.slug} onChange={(event) => patchSelectedLesson({ slug: event.target.value })} placeholder="Slug" />
                    <select value={selectedLesson.category || "beginner"} onChange={(event) => {
                      const category = event.target.value as LessonCategory;
                      patchSelectedLesson({ category, courseId: mapCategoryToCourse(category, courses) });
                    }} className="h-11 rounded-xl border border-white/15 bg-[#101010] px-3 text-sm">
                      <option value="beginner">Beginner</option>
                      <option value="intermediate">Intermediate</option>
                      <option value="advanced">Advanced</option>
                    </select>
                    <Input type="number" value={selectedLesson.lessonNumber || selectedLesson.order} onChange={(event) => patchSelectedLesson({ lessonNumber: Number(event.target.value) || 1 })} placeholder="Lesson Number" />
                    <select value={selectedLesson.difficulty || "medium"} onChange={(event) => patchSelectedLesson({ difficulty: event.target.value as Lesson["difficulty"] })} className="h-11 rounded-xl border border-white/15 bg-[#101010] px-3 text-sm">
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                      <option value="expert">Expert</option>
                    </select>
                    <Input type="number" value={selectedLesson.estimatedDurationMinutes || selectedLesson.durationMinutes} onChange={(event) => {
                      const value = Number(event.target.value) || 1;
                      patchSelectedLesson({ estimatedDurationMinutes: value, durationMinutes: value });
                    }} placeholder="Estimated Duration (min)" />
                    <Input type="number" value={selectedLesson.xpReward || 100} onChange={(event) => patchSelectedLesson({ xpReward: Number(event.target.value) || 0 })} placeholder="XP Reward" />
                    <Input value={selectedLesson.instructor || ""} onChange={(event) => patchSelectedLesson({ instructor: event.target.value })} aria-label="Instructor" placeholder="Instructor" />
                  </div>
                  <Textarea value={selectedLesson.description} onChange={(event) => patchSelectedLesson({ description: event.target.value })} aria-label="Lesson description" placeholder="Description" />
                  <Textarea value={selectedLesson.summary} onChange={(event) => patchSelectedLesson({ summary: event.target.value })} aria-label="Lesson summary" placeholder="Summary" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{isAr ? "إدارة الفيديو" : "Video Management"}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-3">
                    <select value={selectedLesson.assets.videoProvider} onChange={(event) => patchSelectedLesson({ assets: { ...selectedLesson.assets, videoProvider: event.target.value as VideoProvider } })} className="h-11 rounded-xl border border-white/15 bg-[#101010] px-3 text-sm">
                      <option value="self-hosted">Self-hosted</option>
                      <option value="google-drive">Google Drive</option>
                      <option value="supabase">Supabase</option>
                      <option value="bunny-stream">Bunny Stream</option>
                      <option value="cloudflare-r2">Cloudflare R2</option>
                      <option value="vimeo">Vimeo</option>
                    </select>
                    <Input value={selectedLesson.assets.videoId || ""} onChange={(event) => patchSelectedLesson({ assets: { ...selectedLesson.assets, videoId: event.target.value } })} placeholder="videoId" />
                    <Input value={selectedLesson.assets.videoUrl} onChange={(event) => patchSelectedLesson({ assets: { ...selectedLesson.assets, videoUrl: event.target.value } })} placeholder="videoUrl" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-sm">
                      <Upload className="h-4 w-4" />
                      {isAr ? "رفع فيديو" : "Upload Video"}
                      <input type="file" accept="video/*" className="hidden" onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file && selectedLesson) void uploadMedia(file, selectedLesson.id, "video");
                        event.currentTarget.value = "";
                      }} />
                    </label>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{isAr ? "إدارة PDF" : "PDF Management"}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-3">
                    <select value={selectedLesson.assets.pdfProvider} onChange={(event) => patchSelectedLesson({ assets: { ...selectedLesson.assets, pdfProvider: event.target.value as Lesson["assets"]["pdfProvider"] } })} className="h-11 rounded-xl border border-white/15 bg-[#101010] px-3 text-sm">
                      <option value="google-drive">Google Drive</option>
                      <option value="supabase">Supabase</option>
                      <option value="custom-url">Custom URL</option>
                    </select>
                    <Input value={selectedLesson.assets.pdfFileId || ""} onChange={(event) => patchSelectedLesson({ assets: { ...selectedLesson.assets, pdfFileId: event.target.value } })} placeholder="pdfFileId" />
                    <Input value={selectedLesson.assets.pdfUrl} onChange={(event) => patchSelectedLesson({ assets: { ...selectedLesson.assets, pdfUrl: event.target.value } })} placeholder="pdfUrl" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-sm">
                      <Upload className="h-4 w-4" />
                      {isAr ? "رفع PDF" : "Upload PDF"}
                      <input type="file" accept="application/pdf" className="hidden" onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file && selectedLesson) void uploadMedia(file, selectedLesson.id, "pdf");
                        event.currentTarget.value = "";
                      }} />
                    </label>
                    <a className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-sm hover:border-[#C9A227]" href={selectedLesson.assets.pdfUrl || "#"} target="_blank" rel="noreferrer">
                      {isAr ? "معاينة PDF" : "Preview PDF"}
                    </a>
                    <Button size="sm" variant="secondary" onClick={() => patchSelectedLesson({ assets: { ...selectedLesson.assets, pdfUrl: "", pdfFileId: "" } })}>
                      {isAr ? "إزالة PDF" : "Remove PDF"}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{isAr ? "بناء الاختبار" : "Quiz Builder"}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-3">
                    <Input type="number" value={selectedLesson.quizSettings?.passingScore ?? 70} onChange={(event) => patchSelectedLesson({ quizSettings: { ...(selectedLesson.quizSettings || { passingScore: 70, randomizedOrder: false, instantFeedback: true }), passingScore: Number(event.target.value) || 70 } })} placeholder="Passing score" />
                    <label className="flex items-center gap-2 rounded-xl border border-white/10 px-3 text-sm">
                      <input type="checkbox" checked={Boolean(selectedLesson.quizSettings?.randomizedOrder)} onChange={(event) => patchSelectedLesson({ quizSettings: { ...(selectedLesson.quizSettings || { passingScore: 70, randomizedOrder: false, instantFeedback: true }), randomizedOrder: event.target.checked } })} />
                      {isAr ? "ترتيب عشوائي" : "Randomized order"}
                    </label>
                    <label className="flex items-center gap-2 rounded-xl border border-white/10 px-3 text-sm">
                      <input type="checkbox" checked={selectedLesson.quizSettings?.instantFeedback !== false} onChange={(event) => patchSelectedLesson({ quizSettings: { ...(selectedLesson.quizSettings || { passingScore: 70, randomizedOrder: false, instantFeedback: true }), instantFeedback: event.target.checked } })} />
                      {isAr ? "تغذية راجعة فورية" : "Instant feedback"}
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => addQuizQuestion("multiple-choice")}>{isAr ? "سؤال اختيار متعدد" : "Add Multiple Choice"}</Button>
                    <Button size="sm" variant="secondary" onClick={() => addQuizQuestion("true-false")}>{isAr ? "سؤال صح/خطأ" : "Add True/False"}</Button>
                  </div>
                  <div className="space-y-3">
                    {selectedLesson.quiz.map((question, questionIndex) => (
                      <div key={question.id} className="rounded-xl border border-white/10 p-3">
                        <div className="mb-2 flex items-center justify-between text-xs text-[#9CA3AF]">
                          <span>{isAr ? `سؤال ${questionIndex + 1}` : `Question ${questionIndex + 1}`}</span>
                          <button type="button" onClick={() => {
                            patchSelectedLesson({ quiz: selectedLesson.quiz.filter((item) => item.id !== question.id) });
                          }}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                        <Textarea
                          value={question.question}
                          onChange={(event) =>
                            patchSelectedLesson({
                              quiz: selectedLesson.quiz.map((item) => (item.id === question.id ? { ...item, question: event.target.value } : item)),
                            })
                          }
                          placeholder="Question"
                        />
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          {question.options.map((option, optionIndex) => (
                            <Input
                              key={`${question.id}-o-${optionIndex}`}
                              value={option}
                              onChange={(event) =>
                                patchSelectedLesson({
                                  quiz: selectedLesson.quiz.map((item) => {
                                    if (item.id !== question.id) return item;
                                    const nextOptions = [...item.options];
                                    nextOptions[optionIndex] = event.target.value;
                                    return { ...item, options: nextOptions };
                                  }),
                                })
                              }
                              placeholder={`${isAr ? "خيار" : "Option"} ${optionIndex + 1}`}
                            />
                          ))}
                        </div>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          <Input
                            type="number"
                            value={question.correctIndex}
                            onChange={(event) =>
                              patchSelectedLesson({
                                quiz: selectedLesson.quiz.map((item) => (item.id === question.id ? { ...item, correctIndex: Math.max(0, Number(event.target.value) || 0) } : item)),
                              })
                            }
                            placeholder="correct index"
                          />
                          <Input
                            value={question.type || "multiple-choice"}
                            onChange={(event) =>
                              patchSelectedLesson({
                                quiz: selectedLesson.quiz.map((item) => (item.id === question.id ? { ...item, type: event.target.value as QuizQuestion["type"] } : item)),
                              })
                            }
                            placeholder="type"
                          />
                        </div>
                        <Textarea
                          className="mt-2"
                          value={question.explanation}
                          onChange={(event) =>
                            patchSelectedLesson({
                              quiz: selectedLesson.quiz.map((item) => (item.id === question.id ? { ...item, explanation: event.target.value } : item)),
                            })
                          }
                          placeholder={isAr ? "شرح الإجابة الصحيحة" : "Correct answer explanation"}
                        />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{isAr ? "المكتبة الإعلامية" : "Media Library"}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-2 md:grid-cols-2">
                    <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 px-3 py-3 text-sm">
                      <FileUp className="h-4 w-4" />
                      {isAr ? "رفع صورة مصغرة" : "Upload Thumbnail"}
                      <input type="file" accept="image/*" className="hidden" onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file && selectedLesson) void uploadMedia(file, selectedLesson.id, "thumbnail");
                        event.currentTarget.value = "";
                      }} />
                    </label>
                    <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 px-3 py-3 text-sm">
                      <Upload className="h-4 w-4" />
                      {isAr ? "استيراد مجلد كامل" : "Bulk Import Folder"}
                      <input
                        ref={importInputRef}
                        type="file"
                        className="hidden"
                        multiple
                        onChange={(event) => {
                          if (event.target.files?.length) {
                            void runImport(event.target.files);
                            event.currentTarget.value = "";
                          }
                        }}
                      />
                    </label>
                  </div>
                  {selectedLesson.thumbnail ? (
                    <div className="relative h-36 overflow-hidden rounded-xl border border-white/10">
                      <Image src={selectedLesson.thumbnail} alt={selectedLesson.title} fill className="object-cover" sizes="(max-width: 768px) 100vw, 360px" />
                    </div>
                  ) : null}
                  <div className="max-h-56 space-y-2 overflow-auto rounded-xl border border-white/10 p-2">
                    {media.slice(0, 30).map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 p-2 text-xs">
                        <div className="min-w-0 flex-1">
                          <p className="truncate">{item.name}</p>
                          <p className="truncate text-[#9CA3AF]">{item.type} · {item.provider}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (!selectedLesson) return;
                            if (item.type === "thumbnail" || item.type === "image") patchSelectedLesson({ thumbnail: item.url });
                            if (item.type === "video") patchSelectedLesson({ assets: { ...selectedLesson.assets, videoUrl: item.url, videoProvider: "self-hosted", videoId: "" } });
                            if (item.type === "pdf") patchSelectedLesson({ assets: { ...selectedLesson.assets, pdfUrl: item.url, pdfProvider: "supabase", pdfFileId: "" } });
                          }}
                          className="rounded-full border border-white/15 px-2 py-1"
                        >
                          {isAr ? "استخدام" : "Use"}
                        </button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="pt-6 text-sm text-[#9CA3AF]">{isAr ? "اختر درساً للبدء." : "Select a lesson to begin."}</CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{isAr ? "التصدير والنسخ الاحتياطي" : "Export & Backup"}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <a href="/api/admin/export?format=json" target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm", variant: "secondary" })}>
                <Download className="h-4 w-4" />JSON
              </a>
              <a href="/api/admin/export?format=csv" target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm", variant: "secondary" })}>
                <Download className="h-4 w-4" />CSV
              </a>
              <a href="/api/admin/export?format=backup" target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm" })}>
                <Download className="h-4 w-4" />Backup
              </a>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{isAr ? "سجل الإصدارات" : "Version History"}</CardTitle>
            </CardHeader>
            <CardContent className="max-h-56 space-y-2 overflow-auto text-sm">
              {versions.slice(0, 30).map((version) => (
                <div key={version.id} className="rounded-xl border border-white/10 p-2">
                  <p className="font-medium">{version.action}</p>
                  <p className="text-xs text-[#9CA3AF]">{new Date(version.timestamp).toLocaleString(locale)}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {toast ? (
        <div className="fixed bottom-6 end-6 z-50 rounded-full border border-white/20 bg-[#0B0B0B] px-4 py-2 text-sm shadow-xl">
          <div className="flex items-center gap-2">
            {toast.startsWith("✓") ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <AlertCircle className="h-4 w-4 text-amber-300" />}
            {toast}
          </div>
        </div>
      ) : null}

      {saving ? (
        <div className="fixed bottom-20 end-6 z-50 rounded-full border border-[#C9A227]/35 bg-[#0B0B0B] px-3 py-1 text-xs">
          <span className="inline-flex items-center gap-2"><Save className="h-3.5 w-3.5" />{isAr ? "حفظ تلقائي..." : "Auto saving..."}</span>
        </div>
      ) : null}
    </section>
  );
}
