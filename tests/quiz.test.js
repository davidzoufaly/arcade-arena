// tests/quiz.test.js
import { describe, it, expect } from 'vitest';
import {
  seedCategories, orderedCategories, currentCategoryId,
  allCategoriesSubmitted, nextOrder, bonusIndices, teamQuizScore,
  DEFAULT_CATEGORY_COUNT, DEFAULT_QUESTION_COUNT,
} from '../src/shared/quiz.js';

describe('seedCategories', () => {
  it('seeds 4 categories with deterministic c1..c4 keys by default', () => {
    const cats = seedCategories();
    expect(Object.keys(cats)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(cats.c1).toEqual({ order: 0, name: 'Category 1', questionCount: 8 });
    expect(cats.c4).toEqual({ order: 3, name: 'Category 4', questionCount: 8 });
    expect(DEFAULT_CATEGORY_COUNT).toBe(4);
    expect(DEFAULT_QUESTION_COUNT).toBe(8);
  });

  it('honors custom count + questionCount', () => {
    const cats = seedCategories(2, 5);
    expect(Object.keys(cats)).toEqual(['c1', 'c2']);
    expect(cats.c2).toEqual({ order: 1, name: 'Category 2', questionCount: 5 });
  });
});

describe('orderedCategories', () => {
  it('sorts by order and carries id', () => {
    const cats = { b: { order: 1, name: 'B', questionCount: 3 }, a: { order: 0, name: 'A', questionCount: 2 } };
    expect(orderedCategories(cats).map(c => c.id)).toEqual(['a', 'b']);
    expect(orderedCategories(cats)[0]).toEqual({ id: 'a', order: 0, name: 'A', questionCount: 2, bonus: {} });
  });
  it('returns [] for null/empty', () => {
    expect(orderedCategories(null)).toEqual([]);
    expect(orderedCategories({})).toEqual([]);
  });
  it('carries the bonus map (default {} when absent)', () => {
    const cats = {
      a: { order: 0, name: 'A', questionCount: 3, bonus: { 1: true } },
      b: { order: 1, name: 'B', questionCount: 2 },
    };
    const out = orderedCategories(cats);
    expect(out[0].bonus).toEqual({ 1: true });
    expect(out[1].bonus).toEqual({});
  });
});

describe('currentCategoryId', () => {
  const cats = { c1: { order: 0, name: 'A', questionCount: 2 }, c2: { order: 1, name: 'B', questionCount: 2 } };
  it('returns first when none submitted', () => {
    expect(currentCategoryId(cats, null)).toBe('c1');
  });
  it('returns first unsubmitted by order', () => {
    expect(currentCategoryId(cats, { c1: { submittedAt: 1, answers: {} } })).toBe('c2');
  });
  it('returns null when all submitted', () => {
    expect(currentCategoryId(cats, { c1: {}, c2: {} })).toBeNull();
  });
  it('returns null when there are no categories', () => {
    expect(currentCategoryId({}, {})).toBeNull();
  });
});

describe('allCategoriesSubmitted', () => {
  const cats = { c1: { order: 0 }, c2: { order: 1 } };
  it('true only when every category submitted', () => {
    expect(allCategoriesSubmitted(cats, { c1: {}, c2: {} })).toBe(true);
    expect(allCategoriesSubmitted(cats, { c1: {} })).toBe(false);
  });
  it('false when there are no categories', () => {
    expect(allCategoriesSubmitted({}, {})).toBe(false);
  });
});

describe('nextOrder', () => {
  it('is 0 for empty', () => { expect(nextOrder({})).toBe(0); });
  it('is max order + 1', () => {
    expect(nextOrder({ a: { order: 0 }, b: { order: 5 } })).toBe(6);
  });
  it('avoids collision when categories share an order', () => {
    expect(nextOrder({ a: { order: 2 }, b: { order: 2 } })).toBe(3);
  });
});

describe('bonusIndices', () => {
  it('returns flagged indices as sorted numbers', () => {
    expect(bonusIndices({ questionCount: 5, bonus: { 3: true, 1: true } })).toEqual([1, 3]);
  });
  it('coerces string keys (Firebase) to numbers', () => {
    expect(bonusIndices({ questionCount: 5, bonus: { '2': true } })).toEqual([2]);
  });
  it('filters out indices >= questionCount (stale flags)', () => {
    expect(bonusIndices({ questionCount: 3, bonus: { 1: true, 4: true } })).toEqual([1]);
  });
  it('returns [] when no bonus map', () => {
    expect(bonusIndices({ questionCount: 4 })).toEqual([]);
  });
  it('returns [] for empty/undefined category', () => {
    expect(bonusIndices({})).toEqual([]);
    expect(bonusIndices()).toEqual([]);
  });
});

describe('teamQuizScore', () => {
  const cats = {
    c1: { order: 0, name: 'A', questionCount: 3, bonus: { 1: true } },
    c2: { order: 1, name: 'B', questionCount: 2 },
  };

  it('returns 0 for empty/missing grades', () => {
    expect(teamQuizScore(null, cats)).toBe(0);
    expect(teamQuizScore({}, cats)).toBe(0);
  });

  it('scores 1 per correct base question', () => {
    const grades = { c1: { 0: { q: true }, 2: { q: true } }, c2: { 0: { q: true } } };
    expect(teamQuizScore(grades, cats)).toBe(3);
  });

  it('adds +1 extra only when the index is flagged bonus and base is correct', () => {
    expect(teamQuizScore({ c1: { 1: { q: true, b: true } } }, cats)).toBe(2);
    expect(teamQuizScore({ c1: { 0: { q: true, b: true } } }, cats)).toBe(1);
  });

  it('scores 0 for a lone bonus with no correct base', () => {
    expect(teamQuizScore({ c1: { 1: { b: true } } }, cats)).toBe(0);
  });

  it('ignores indices >= questionCount and grades for absent categories', () => {
    const grades = {
      c1: { 5: { q: true } },
      gone: { 0: { q: true } },
    };
    expect(teamQuizScore(grades, cats)).toBe(0);
  });

  it('coerces Firebase string keys and sums across categories', () => {
    const grades = { c1: { '0': { q: true }, '1': { q: true, b: true } }, c2: { '1': { q: true } } };
    expect(teamQuizScore(grades, cats)).toBe(4);
  });
});
