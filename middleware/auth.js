function auth(role = null) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/login.html');
    if (role && req.session.user.role !== role) {
      return res.status(403).send('Forbidden');
    }
    next();
  };
}

router.get('/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not logged in' });
  }

  res.json(req.session.user);
});


module.exports = auth;
