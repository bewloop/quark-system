function auth(role = null) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/login.html');
    if (role && req.session.user.role !== role) {
      return res.status(403).send('Forbidden');
    }
    next();
  };
}

module.exports = auth;
