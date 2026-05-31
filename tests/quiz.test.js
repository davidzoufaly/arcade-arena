// tests/quiz.test.js
import { describe, it, expect } from 'vitest';
import {
  seedCategories, orderedCategories, currentCategoryId,
  allCategoriesSubmitted, nextOrder,
  DEFAULT_CATEGORY_COUNT, DEFAULT_QUESTION_COUNT,
} from '../ps-offsite-2026/shared/quiz.js';

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
    expect(orderedCategories(cats)[0]).toEqual({ id: 'a', order: 0, name: 'A', questionCount: 2 });
  });
  it('returns [] for null/empty', () => {
    expect(orderedCategories(null)).toEqual([]);
    expect(orderedCategories({})).toEqual([]);
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
});
