import type { Pool, PoolClient } from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import lessonsSeed from "@/data/lessons.json";
import mediaSeed from "@/data/media-library.json";
import versionsSeed from "@/data/lesson-versions.json";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { rollbackFailedTransaction } from "@/lib/postgres-transaction";
import type { Lesson } from "@/types/academy";
import type { LessonVersion, MediaItem } from "@/types/admin";

type AdminContentSnapshot = {
  lessons: Lesson[];
  versions: LessonVersion[];
  media: MediaItem[];
};

type AdminContentTableName = "lessons" | "versions" | "media";

const DEFAULT_SNAPSHOT: AdminContentSnapshot = {
  lessons: lessonsSeed as Lesson[],
  versions: versionsSeed as LessonVersion[],
  media: mediaSeed as MediaItem[],
};

const SCHEMA_SQL = [
  "create schema if not exists admin_cms",
  `create table if not exists admin_cms.lessons (
    id text primary key,
    slug text not null unique,
    course_id text not null,
    category text not null,
    status text not null,
    lesson_order integer not null,
    updated_at timestamptz,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists admin_cms.lesson_versions (
    id text primary key,
    lesson_id text not null,
    action text not null,
    role text not null,
    version_timestamp timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  `create table if not exists admin_cms.media_items (
    id text primary key,
    type text not null,
    provider text not null,
    name text not null,
    url text not null,
    storage_bucket text,
    storage_key text,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    sort_index integer not null,
    payload jsonb not null
  )`,
  "create index if not exists idx_admin_cms_lessons_course_order on admin_cms.lessons (course_id, lesson_order)",
  "create index if not exists idx_admin_cms_lessons_status on admin_cms.lessons (status)",
  "create index if not exists idx_admin_cms_lesson_versions_lesson_ts on admin_cms.lesson_versions (lesson_id, version_timestamp desc)",
  "create index if not exists idx_admin_cms_media_updated_at on admin_cms.media_items (updated_at desc)",
  "create index if not exists idx_admin_cms_media_storage on admin_cms.media_items (storage_bucket, storage_key)",
];

declare global {
  var __adminContentRepositoryPromise: Promise<AdminContentRepository> | undefined;
  var __adminContentMemorySnapshot: AdminContentSnapshot | undefined;
}

function cloneSnapshot(snapshot: AdminContentSnapshot): AdminContentSnapshot {
  return structuredClone(snapshot);
}

function ensureMemorySeed() {
  if (!globalThis.__adminContentMemorySnapshot) {
    globalThis.__adminContentMemorySnapshot = cloneSnapshot(DEFAULT_SNAPSHOT);
  }
}

async function runSchema(target: Pool | PoolClient) {
  for (const statement of SCHEMA_SQL) {
    await target.query(statement);
  }
}

let memoryMutationTail = Promise.resolve();

export class AdminContentRepository {
  private readonly pool: Pool | null;
  private readonly usesMemoryFallback: boolean;
  private initPromise: Promise<void> | null = null;
  private readonly mutation = new AsyncLocalStorage<{ client?: PoolClient; snapshot?: AdminContentSnapshot }>();

  constructor(pool: Pool | null) {
    this.pool = pool;
    this.usesMemoryFallback = pool === null;
  }

  async ensureReady() {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const pool = this.pool;
        if (this.usesMemoryFallback || !pool) {
          ensureMemorySeed();
          return;
        }

        const client = await pool.connect();
        let destroy = false;
        try {
          await client.query("begin");
          await client.query("select pg_advisory_xact_lock(61422918)");
          await runSchema(client);
          const counts = await Promise.all(["lessons", "lesson_versions", "media_items"].map(table =>
            client.query<{ count: string }>(`select count(*)::text as count from admin_cms.${table}`)));
          if (counts.every(result => result.rows[0]?.count === "0")) {
            await this.persistSnapshot(client, DEFAULT_SNAPSHOT, ["lessons", "versions", "media"]);
          }
          await client.query("commit");
        } catch (error) {
          destroy = await rollbackFailedTransaction(client, error);
          throw error;
        } finally { client.release(destroy); }
      })().catch(error => { this.initPromise = null; throw error; });
    }

    await this.initPromise;
  }

  async loadSnapshot(): Promise<AdminContentSnapshot> {
    await this.ensureReady();
    const context = this.mutation.getStore();
    const pool = context?.client ?? this.pool;
    if (this.usesMemoryFallback || !pool) {
      ensureMemorySeed();
      return cloneSnapshot(context?.snapshot ?? globalThis.__adminContentMemorySnapshot as AdminContentSnapshot);
    }

    const [lessonsResult, versionsResult, mediaResult] = await Promise.all([
      pool.query<{ payload: Lesson }>(
        "select payload from admin_cms.lessons order by lesson_order asc, sort_index asc",
      ),
      pool.query<{ payload: LessonVersion }>(
        "select payload from admin_cms.lesson_versions order by version_timestamp desc, sort_index asc",
      ),
      pool.query<{ payload: MediaItem }>(
        "select payload from admin_cms.media_items order by updated_at desc, sort_index asc",
      ),
    ]);

    return {
      lessons: lessonsResult.rows.map((row) => row.payload),
      versions: versionsResult.rows.map((row) => row.payload),
      media: mediaResult.rows.map((row) => row.payload),
    };
  }

  /** All reads, writes and audit entries in an owner action share one transaction. */
  async mutate<T>(action: () => Promise<T>): Promise<T> {
    if (this.mutation.getStore()) return action();
    await this.ensureReady();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      const previous = memoryMutationTail;
      let release!: () => void;
      memoryMutationTail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const context = { snapshot: cloneSnapshot(globalThis.__adminContentMemorySnapshot as AdminContentSnapshot) };
      try {
        const result = await this.mutation.run(context, action);
        globalThis.__adminContentMemorySnapshot = cloneSnapshot(context.snapshot);
        return result;
      } finally { release(); }
    }
    const client = await pool.connect();
    let destroy = false;
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(61422918)");
      const result = await this.mutation.run({ client }, action);
      await client.query("commit");
      return result;
    } catch (error) {
      destroy = await rollbackFailedTransaction(client, error);
      throw error;
    } finally { client.release(destroy); }
  }

  async saveSnapshot(snapshot: AdminContentSnapshot, options?: { skipReadyCheck?: boolean; selectedTables?: readonly AdminContentTableName[] }) {
    const selectedTables = options?.selectedTables ?? ["lessons", "versions", "media"];
    const context = this.mutation.getStore();
    const pool = this.pool;
    if (this.usesMemoryFallback || !pool) {
      const current = context?.snapshot ?? globalThis.__adminContentMemorySnapshot ?? DEFAULT_SNAPSHOT;
      const next = cloneSnapshot(current);
      for (const table of selectedTables) Object.assign(next, { [table]: structuredClone(snapshot[table]) });
      if (context) context.snapshot = next;
      else globalThis.__adminContentMemorySnapshot = next;
      return;
    }
    if (context?.client) {
      await this.persistSnapshot(context.client, snapshot, selectedTables);
      return;
    }
    if (!options?.skipReadyCheck) await this.ensureReady();
    else await runSchema(pool);
    await this.mutate(async () => {
      await this.persistSnapshot(this.mutation.getStore()!.client!, snapshot, selectedTables);
    });
  }

  private async persistSnapshot(client: PoolClient, snapshot: AdminContentSnapshot, selectedTables: readonly AdminContentTableName[]) {
    if (selectedTables.includes("lessons")) {
      await client.query("truncate table admin_cms.lessons");
      for (const [index, lesson] of snapshot.lessons.entries()) {
        await client.query(
          `insert into admin_cms.lessons
            (id, slug, course_id, category, status, lesson_order, updated_at, sort_index, payload)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
          [
            lesson.id,
            lesson.slug,
            lesson.courseId,
            lesson.category ?? "beginner",
            lesson.status ?? "published",
            lesson.order,
            lesson.updatedAt ? new Date(lesson.updatedAt) : null,
            index,
            JSON.stringify(lesson),
          ],
        );
      }
    }

    if (selectedTables.includes("versions")) {
      await client.query("truncate table admin_cms.lesson_versions");
      for (const [index, version] of snapshot.versions.entries()) {
        await client.query(
          `insert into admin_cms.lesson_versions
            (id, lesson_id, action, role, version_timestamp, sort_index, payload)
           values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          [
            version.id,
            version.lessonId,
            version.action,
            version.role,
            new Date(version.timestamp),
            index,
            JSON.stringify(version),
          ],
        );
      }
    }

    if (selectedTables.includes("media")) {
      await client.query("truncate table admin_cms.media_items");
      for (const [index, item] of snapshot.media.entries()) {
        await client.query(
          `insert into admin_cms.media_items
            (id, type, provider, name, url, storage_bucket, storage_key, created_at, updated_at, sort_index, payload)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
          [
            item.id,
            item.type,
            item.provider,
            item.name,
            item.url,
            item.storageBucket ?? null,
            item.storageKey ?? null,
            new Date(item.createdAt),
            new Date(item.updatedAt),
            index,
            JSON.stringify(item),
          ],
        );
      }
    }

  }

  async loadLessons() {
    const snapshot = await this.loadSnapshot();
    return snapshot.lessons;
  }

  async saveLessons(lessons: Lesson[]) {
    const snapshot = await this.loadSnapshot();
    await this.saveSnapshot({ ...snapshot, lessons }, { selectedTables: ["lessons"] });
  }

  async loadVersions() {
    const snapshot = await this.loadSnapshot();
    return snapshot.versions;
  }

  async saveVersions(versions: LessonVersion[]) {
    const snapshot = await this.loadSnapshot();
    await this.saveSnapshot({ ...snapshot, versions }, { selectedTables: ["versions"] });
  }

  async loadMedia() {
    const snapshot = await this.loadSnapshot();
    return snapshot.media;
  }

  async saveMedia(media: MediaItem[]) {
    const snapshot = await this.loadSnapshot();
    await this.saveSnapshot({ ...snapshot, media }, { selectedTables: ["media"] });
  }
}

export async function getAdminContentRepository() {
  if (!globalThis.__adminContentRepositoryPromise) {
    globalThis.__adminContentRepositoryPromise = Promise.resolve(
      new AdminContentRepository(getRuntimePostgresPool()),
    );
  }

  return globalThis.__adminContentRepositoryPromise;
}
