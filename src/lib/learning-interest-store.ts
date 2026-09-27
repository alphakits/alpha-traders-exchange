import "server-only";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { LEARNING_INTEREST_SUBJECT } from "@/lib/learning-interest";

export const LEARNING_INTEREST_QUERY = `
  WITH latest AS (
    SELECT DISTINCT ON (lower(btrim(email))) id, name, email, message, created_at, campaign_link_id
    FROM public.contact_submissions
    WHERE subject = ANY($1::text[]) AND status <> 'spam'
    ORDER BY lower(btrim(email)), created_at DESC, id DESC
  )
  SELECT id, name, email, message, created_at, campaign_link_id, count(*) OVER()::int AS total
  FROM latest ORDER BY created_at DESC, id DESC LIMIT 100
`;

export type LearningInterest = {
  id: string;
  name: string;
  email: string;
  message: string;
  created_at: string | Date;
  campaign_link_id: string | null;
  total: number;
};

// Call only after a fresh server-side owner authorization check.
export async function readLearningInterests(): Promise<LearningInterest[]> {
  const pool = getRuntimePostgresPool();
  if (!pool) throw new Error("Learning interest storage unavailable");
  const result = await pool.query<LearningInterest>(LEARNING_INTEREST_QUERY, [Object.values(LEARNING_INTEREST_SUBJECT)]);
  return result.rows;
}
