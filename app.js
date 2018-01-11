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

var isDebug = false; // デバッグ時はTRUE

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
var mode = 'title'; // title->タイトル, entry->エントリー待機中, game->ゲーム中, debug->デバッグ

// ラウンドごとに初期化が必要
var atariId = -1; // そのラウンドのあたり札
var yomiEndPlayersId = []; // クライアント側で歌読みが終わったプレイヤー一覧
var roundWinnerId = -1; // そのラウンドの勝者ID

// ゲームごとに初期化が必要
var cardList = []; // 100首の札リスト
var deck = []; // 場の札リスト
var readyToFightUsersId = []; // ゲームの準備が整ったプレイヤー一覧

function createPlayer(id, name, hp, atk) {
    return {id: id, name: name, hp: hp, atk: atk};
}

io.on('connection', function(socket) {
    console.log('a user connected');
    var currentTime = Math.floor(new Date().getTime() / 1000);

    if (mode === 'entry' && players.length > 0) {
        emitNameEntry(players, Math.max(ENTRY_TIME_LIMIT - (currentTime - lastEntryTime), 0));
    }

    socket.on('send ping', function(pingData) {
        socket.emit('send pong', new Date().getTime() - pingData.ping);
    });

    // エントリー受付
    socket.on('name entry', function(name) {
        if (players.length <= 2) {
            entryMode();
            players.push(createPlayer(idCount++, name, 1000, 100));
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
            gameStart(isDebug);
        }
    });

    // 誰かが取った時
    socket.on('harai', function(resp) {
        debug(resp);
        // 既にラウンド勝者が決まっている場合は何もしない
        if (roundWinnerId >= 0) {
            return;
        }

        // あたり札を取った
        if (atariId === resp.atari) {
            roundWinnerId = resp.userId;
            var rival = getRival(resp.userId);
            var player = getPlayer(resp.userId);
            var updatedHp = rival.hp - player.atk;
            updateHp(rival, updatedHp);
            io.emit('harai atari', resp);
        } else { // お手つきをした
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

    socket.on('fetch game info', function() {
        if (players.length === 2) {
            return;
        }
    });

});

function updateHp(player, hp) {
    player.hp = hp;
    io.emit('update hp', players);
}

function getPlayer(userId) {
    return __.find(players, function(player) {
        return player.id === userId;
    });
}

// 対戦相手を取得する
function getRival(userId) {
    return __.find(players, function(player) {
        return player.id !== userId;
    });
}

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

function gameStart(opt_skipJoka) {
    setUpGame();
    io.emit('game start', {deck: deck});
    gameMode();
    if (opt_skipJoka) {
        roundStart();
    }  else {
        jokaStart();
    }
}

function jokaStart() {
    io.emit('joka start');
}

function roundStart() {
    roundReset();
    deck = __.shuffle(deck);
    atariId = deck.shift();
    if (atariId) {
        io.emit('round start', {atari: atariId});
    }
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
