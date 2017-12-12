var express = require('express');
var app = express();
var path = require('path');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var http = require('http');
var server = http.createServer(app);
var io = require('socket.io').listen(server);
var __ = require('underscore');

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

var ENTRY_TIME_LIMIT = 180;
var MAX_DECK_SIZE = 12; // 場に出る札の数
var idCount = 0;

// セッションごとに初期化が必要
var players = [];
var entryTimeout = null;
var lastEntryTime = 0; // 最新のエントリー時間
var mode = 'title'; // title->タイトル, entry->エントリー待機中, game->ゲーム中

// ラウンドごとに初期化が必要
var atariId = -1; // そのラウンドのあたり札
var yomiEndPlayersId = []; // クライアント側で歌読みが終わったプレイヤー一覧
var roundWinnerId = -1; // そのラウンドの勝者ID

// ゲームごとに初期化が必要
var atariFudas = []; // あたり札の履歴
var cardList = []; // 100首の札リスト
var deck = []; // 場の札リスト
var readyToFightUsersId = []; // ゲームの準備が整ったプレイヤー一覧

io.on('connection', function(socket) {
    console.log('a user connected');
    var currentTime = Math.floor(new Date().getTime() / 1000);

    if (players.length > 0) {
        emitNameEntry(players, Math.max(ENTRY_TIME_LIMIT - (currentTime - lastEntryTime), 0));
    }

    // エントリー受付
    socket.on('name entry', function(name) {
        if (players.length <= 2) {
            entryMode();
            players.push({id: idCount++, name: name});
            emitNameEntry(players, ENTRY_TIME_LIMIT);
            lastEntryTime = Math.floor(new Date().getTime() / 1000);

            entryTimeout && clearTimeout(entryTimeout);
            entryTimeout = setTimeout(function() {
                // 時間内に二人集まらなかったら解散
                if (players.length < 2) {
                    players = [];
                    emitNameEntry(players, 0);
                    titleMode();
                }
            }, ENTRY_TIME_LIMIT * 1000);

            if (players.length === 2) { // マッチング成立
                io.emit('ready game');
            }
        }
    });

    socket.on('user exit', function(userId) {
        if (mode === 'entry') {
            removePlayer(userId);
            emitNameEntry(players, ENTRY_TIME_LIMIT);
            if (players.length === 0) {
                titleMode();
            }
        } else if (mode === 'game') {
            io.emit('game exit');
            titleMode();
        }
    });

    socket.on('ready to fight', function(userId) {
        if (readyToFightUsersId.indexOf(userId) < 0) {
            readyToFightUsersId.push(userId);
        }

        if (readyToFightUsersId.length === players.length) {
            readyToFightUsersId = [];
            gameStart();
        }
    });

    // 誰かが取った時
    socket.on('harai', function(resp) {
        debug(resp);
        // 既にラウンド勝者が決まっている場合は何もしない
        if (roundWinnerId >= 0) {
            return;
        }

        if (atariId === resp.atari) {
            roundWinnerId = resp.userId;
            io.emit('harai atari', resp);
        } else {
            io.emit('harai otetsuki', resp);
        }
    });

    // 歌が読み終わった時
    socket.on('yomi end', function(userId) {
        if (yomiEndPlayersId.indexOf(userId) < 0) {
            yomiEndPlayersId.push(userId);
        }

        if (yomiEndPlayersId.length === players.length) {
            yomiEndPlayersId = [];
            roundStart();
        }
    });
});

function removePlayer(userId) {
    players = __.filter(players, function(player) {
        return player.id !== userId;
    });
}

function titleMode() {
    mode = 'title';
    reset();
}

function entryMode() {
    mode = 'entry';
}

function gameMode() {
    mode = 'game';
}

function setUpGame() {
    gameReset();

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
    setUpGame();
    io.emit('game start', {deck: deck});
    gameMode();
    jokaStart();
}

function jokaStart() {
    io.emit('joka start');
}

function roundStart() {
    roundReset();
    do {
        atariId = deck[Math.floor(Math.random() * (deck.length - 1))];
    } while(atariFudas.indexOf(atariId) >= 0 && atariFudas.length !== deck.length) ;
    atariFudas.push(atariId);

    io.emit('round start', {atari: atariId});
}

function emitNameEntry(players, remain) {
    io.emit('name entry', {players: players, remain: remain});
}

function roundReset() {
    roundWinnerId = -1;
    yomiEndPlayersId = [];
}

function gameReset() {
    cardList = [];
    deck = [];
}

function reset() {
    roundReset();
    gameReset();

    players = [];
    lastEntryTime = 0;
    atariFudas = [];
    entryTimeout && clearTimeout(entryTimeout);
}

setUpGame();
server.listen(3000);
module.exports = app;
