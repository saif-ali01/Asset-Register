import { ApiError } from '../utils/ApiError.js';

/** validate({ body: schema, query: schema, params: schema }) using zod. */
export const validate = (schemas) => (req, _res, next) => {
  for (const key of ['body', 'query', 'params']) {
    if (!schemas[key]) continue;
    const result = schemas[key].safeParse(req[key]);
    if (!result.success) {
      const details = {};
      for (const issue of result.error.issues) details[issue.path.join('.') || key] = issue.message;
      return next(ApiError.badRequest('Some fields need attention', details));
    }
    req[key] = result.data;
  }
  next();
};
