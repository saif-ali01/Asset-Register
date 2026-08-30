/** Parses ?page&limit&sort into mongo-ready options. */
export function parsePagination(query, { defaultLimit = 25, maxLimit = 200 } = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number(query.limit) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

export function parseSort(sortParam, fallback = '-createdAt') {
  const raw = (sortParam || fallback).toString();
  const allowed = /^-?[a-zA-Z0-9_.]+$/;
  return allowed.test(raw) ? raw.replace(/\./g, '.') : fallback;
}

export function meta({ page, limit, total }) {
  return { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)), hasMore: page * limit < total };
}

/** Escapes user input before it reaches a $regex. */
export const escapeRegex = (s = '') => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
