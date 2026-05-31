// ps-offsite-2026/shared/quiz.js
// Pure helpers for the Pub Quiz category/question flow. No Firebase imports
// (so this is unit-testable and usable inside the Firebase-free lobby.js).
//
// Category map (Firebase node lobbies/{id}/quiz/categories):
//   { [catId]: { order:int, name:string, questionCount:int, bonus?:{ [idx]: true } } }
// Submissions for ONE team (lobbies/{id}/quiz/submissions/{teamId}):
//   { [catId]: { submittedAt:int, answers: { [idx]: string } } }

export const DEFAULT_CATEGORY_COUNT = 4;
export const DEFAULT_QUESTION_COUNT = 8;

// Seed map for a new lobby. Deterministic keys c1..cN so it can be created
// inside the Firebase-free createLobby() (which cannot mint push ids).
export function seedCategories(count = DEFAULT_CATEGORY_COUNT, questionCount = DEFAULT_QUESTION_COUNT) {
  const out = {};
  for (let i = 0; i < count; i++) {
    out[`c${i + 1}`] = { order: i, name: `Category ${i + 1}`, questionCount };
  }
  return out;
}

// Categories sorted by order, as [{ id, order, name, questionCount, bonus }].
export function orderedCategories(categories) {
  return Object.entries(categories || {})
    .map(([id, c]) => ({
      id,
      order: c?.order ?? 0,
      name: c?.name ?? '',
      questionCount: c?.questionCount ?? 0,
      bonus: c?.bonus ?? {},
    }))
    .sort((a, b) => a.order - b.order);
}

// First category (by order) the team has NOT submitted, or null if every
// category is submitted / there are no categories.
export function currentCategoryId(categories, submissions) {
  const subs = submissions || {};
  for (const cat of orderedCategories(categories)) {
    if (!subs[cat.id]) return cat.id;
  }
  return null;
}

// True iff there is >=1 category and the team submitted all of them.
export function allCategoriesSubmitted(categories, submissions) {
  return orderedCategories(categories).length > 0
    && currentCategoryId(categories, submissions) === null;
}

// Order int for a newly added category (append after the current max).
export function nextOrder(categories) {
  const ordered = orderedCategories(categories);
  if (!ordered.length) return 0;
  return Math.max(...ordered.map(c => c.order)) + 1;
}

// Total Pub Quiz points for ONE team's grade map. grades is
// { [catId]: { [idx]: { q?:true, b?:true } } }; categories is the lobby
// category map (for questionCount bounds + bonus flags). +1 per correct base
// question (q), +1 extra only when the index is flagged bonus AND the base is
// also correct. Stale categories, out-of-range indices, and bonus marks on
// non-bonus indices are ignored so old grades never inflate the score.
export function teamQuizScore(grades, categories) {
  const cats = categories || {};
  let total = 0;
  for (const [catId, marks] of Object.entries(grades || {})) {
    const cat = cats[catId];
    if (!cat) continue;
    const qc = cat.questionCount ?? 0;
    const bonus = cat.bonus || {};
    for (const [k, m] of Object.entries(marks || {})) {
      const i = Number(k);
      if (!Number.isInteger(i) || i < 0 || i >= qc) continue;
      if (!m || !m.q) continue;
      total += 1;
      if (bonus[i] && m.b) total += 1;
    }
  }
  return total;
}

// Sorted integer indices flagged as bonus AND within the question count.
// Firebase stores bonus keys as strings and only the value `true`; a cleared
// flag is deleted (absent), never false. Accepts any object with
// { questionCount, bonus } — an orderedCategories item or a raw category node.
export function bonusIndices({ questionCount = 0, bonus } = {}) {
  return Object.keys(bonus || {})
    .filter(k => bonus[k])
    .map(Number)
    .filter(i => Number.isInteger(i) && i >= 0 && i < questionCount)
    .sort((a, b) => a - b);
}
