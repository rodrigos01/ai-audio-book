const { NotFoundError, ValidationError, UnauthorizedError, ForbiddenError } = require('../utils/errors');

function handleRouteError(res, err) {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.message });
  }
  if (err instanceof UnauthorizedError) {
    return res.status(401).json({ error: err.message });
  }
  if (err instanceof ForbiddenError) {
    return res.status(403).json({ error: err.message });
  }
  if (err instanceof NotFoundError) {
    return res.status(404).json({ error: err.message });
  }
  res.status(500).json({ error: err.message });
}

module.exports = handleRouteError;
