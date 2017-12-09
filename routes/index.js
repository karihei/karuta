var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'かるた・エクサ・バトリア' });
});

module.exports = router;
