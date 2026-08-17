/**
 * General organization Knowledge should capture operating principles,
 * not personal profiles (title, rank, private values).
 * Expert names may live in Q&A source metadata, not as the Knowledge body.
 */

const TITLE_PROFILE_RE =
  /に対する考え方|の考え方|の価値観|個人プロフィール|のプロフィール|の経歴|の人となり|私の信念/i;

const BODY_PROFILE_RE =
  /(役職は|肩書は|社内権限は|個人的な価値観|個人の信念|私は.+と考えている)/;

export type PersonalProfileFlag = {
  flagged: boolean;
  reasons: string[];
};

export function detectPersonalProfileKnowledge(input: {
  title: string;
  content: string;
  importMode?: string;
}): PersonalProfileFlag {
  if (input.importMode === "qa") {
    return { flagged: false, reasons: [] };
  }
  const reasons: string[] = [];
  if (TITLE_PROFILE_RE.test(input.title)) {
    reasons.push("title_looks_like_personal_profile");
  }
  if (BODY_PROFILE_RE.test(input.content)) {
    reasons.push("body_looks_like_personal_profile");
  }
  return { flagged: reasons.length > 0, reasons };
}

/** Filename / title helper: "operating-principles.md" → "operating principles". */
export function titleFromFilename(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  const cleaned = base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || filename).slice(0, 200);
}
