import { env } from '../config/env.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
}

export function errorHandler(err, req, res, _next) {
  let status = err.status || 500;
  let message = err.message || 'Something went wrong';
  let details = err.details;

  if (err.name === 'ValidationError') {
    status = 400;
    message = 'Some fields need attention';
    details = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message]));
  } else if (err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyPattern || {})[0] || 'value';
    // tagKey is an internal uniqueness column; report it against the field
    // the user actually typed so the error lands on the right input.
    const FRIENDLY = { tagKey: 'tag', tag: 'tag', email: 'email', name: 'name' };
    const shown = FRIENDLY[field] || field;
    const LABEL = { tag: 'asset tag', email: 'email address', name: 'name' };
    message = `That ${LABEL[shown] || shown} is already in use`;
    details = { [shown]: 'Already in use' };
  } else if (err.name === 'CastError') {
    status = 400;
    message = `${err.path} is not a valid id`;
  } else if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    status = 401;
    message = 'Your session expired. Sign in again.';
  }

  if (status >= 500) console.error(err);
  res.status(status).json({
    error: message,
    ...(details ? { details } : {}),
    ...(env.isProd ? {} : { stack: err.stack }),
  });
}
