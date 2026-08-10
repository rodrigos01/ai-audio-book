const { v4: uuidv4 } = require('uuid');

function clientIdMiddleware(req, res, next) {
  let clientId = req.headers['x-client-id'] || req.cookies.client_id || req.query.client_id;
  if (!clientId) {
    clientId = uuidv4();
  }
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('client_id', clientId, {
    maxAge: 1000 * 60 * 60 * 24 * 365,
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd
  });

  res.setHeader('Access-Control-Expose-Headers', 'x-client-id');
  res.setHeader('x-client-id', clientId);

  req.clientId = clientId;
  next();
}

module.exports = clientIdMiddleware;
