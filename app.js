var express = require('express');
var app = express();
var path = require('path');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var http = require('http');
var server = http.createServer(app);
var io = require('socket.io').listen(server);

var debug = require('debug')('karuta:server');
var index = require('./routes/index');
var api   = require('./routes/api');

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', index);
app.use('/api', api);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});


var playerNames = [];
var ENTRY_TIME_LIMIT = 180;
var entryTimeout = null;
var lastEntryTime = 0;
var MAX_DECK_SIZE = 12; // 場に出る札の数

io.on('connection', function(socket) {
    console.log('a user connected');
    var currentTime = Math.floor(new Date().getTime() / 1000);
    emitNameEntry(playerNames, Math.max(ENTRY_TIME_LIMIT - (currentTime - lastEntryTime), 1));

    // エントリー受付
    socket.on('name entry', function(name) {
        if (playerNames.length <= 2) {
            playerNames.push(name);
            emitNameEntry(playerNames, ENTRY_TIME_LIMIT);
            lastEntryTime = Math.floor(new Date().getTime() / 1000);

            entryTimeout && clearTimeout(entryTimeout);
            entryTimeout = setTimeout(function() {
                // 時間内に二人集まらなかったら解散
                if (playerNames.length < 2) {
                    playerNames = [];
                    emitNameEntry(playerNames, 0);
                }
            }, ENTRY_TIME_LIMIT * 1000);
        }
    });

    // 対戦準備OK
    socket.on('ready fight', function() {
        gameStart();
    });

    socket.on('user exit', function() {
        playerNames = [];
        emitNameEntry(playerNames, 0);
    });

    // 誰かが取った時
    socket.on('harai', function(resp) {
        if (atariId == resp.atari) {
            io.emit('harai atari', resp);
        }
    });
});

var cardList = [];
var deck = [];

function setUpGame() {
    // ゲームで使う札一覧をランダム生成する
    for(var i = 0;i < 100;i++) {
        cardList.push(i);
    }
    cardList.sort(function() {return Math.random()-.5});
    for(var j = 0;j < MAX_DECK_SIZE;j++) {
        deck.push(cardList.shift());
    }
}

function gameStart() {
    io.emit('game start', {deck: deck});

    // test
    setTimeout(function() {
        roundStart();
    }, 500);
}

var atariId = -1;

function roundStart() {
    if (atariId < 0) {
        atariId = deck[Math.floor(Math.random() * (deck.length - 1))];
    }
    io.emit('round start', {atari: atariId});
}

function emitNameEntry(players, remain) {
    io.emit('name entry', {players: playerNames, remain: remain});
}

setUpGame();
server.listen(3000);
module.exports = app;
