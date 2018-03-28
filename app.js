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
var mode = 'title'; // title->タイトル, entry->エントリー待機中, game->ゲーム中, debug->デバッグ, result->結果画面
var heatBeatInterval = null; // 生存確認用
var currentPlayersPings = {}; // {userId: pingの送信時刻(UNIX time)}

// ラウンドごとに初期化が必要
var atariId = -1; // そのラウンドのあたり札
var yomiEndPlayersId = []; // クライアント側で歌読みが終わったプレイヤー一覧
var roundWinnerId = -1; // そのラウンドの勝者ID
var roundTime = 0; // そのラウンドの経過時間

// ゲームごとに初期化が必要
var cardList = []; // 100首の札リスト
var deck = []; // 場の札リスト
var readyToFightUsersId = []; // ゲームの準備が整ったプレイヤー一覧

function createPlayer(id, name, hp, atk) {
    return {id: id, name: name, hp: hp, atk: atk, speeds: [], count: 0};
}

io.on('connection', function(socket) {
    console.log('a user connected');
    var currentTime = Math.floor(new Date().getTime() / 1000);

    if (mode === 'entry' && players.length > 0) {
        emitNameEntry(players, Math.max(ENTRY_TIME_LIMIT - (currentTime - lastEntryTime), 0));
    }

    socket.on('send ping', function(pingData) {
        // pingData: {userId: Int , ping: Int}
        socket.emit('send pong', new Date().getTime() - pingData.ping);
        currentPlayersPings[pingData.userId] = pingData.ping
    });

    // エントリー受付
    socket.on('name entry', function(name) {
        if (players.length <= 2) {
            entryMode();
            players.push(createPlayer(idCount++, name, 1000, 200));
            if (isDebug) {
                players.push(createPlayer(idCount++, name + '_2p', 1000, 100));
            }
            emitNameEntry(players, ENTRY_TIME_LIMIT);
            lastEntryTime = Math.floor(new Date().getTime() / 1000);

            entryTimeout && clearTimeout(entryTimeout);
            if (players.length <= 2) {
                entryTimeout = setTimeout(function() {
                    // 時間内に二人集まらなかったら解散
                    if (players.length < 2) {
                        players = [];
                        emitNameEntry(players, 0);
                        titleMode();
                    }
                }, ENTRY_TIME_LIMIT * 1000);
            }
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

        if (readyToFightUsersId.length === players.length || isDebug) {
            readyToFightUsersId = [];
            gameStart(isDebug);
        }
    });

    // 誰かが取った時
    socket.on('harai', function(resp) {
        // あたり札を取った
        if (atariId === resp.atari) {
            var toriTime = new Date().getTime();
            // 既にラウンド勝者が決まっている場合は何もしない
            if (roundWinnerId >= 0) {
                return;
            }

            roundWinnerId = resp.userId;
            var rival = getRival(resp.userId);
            var player = getPlayer(resp.userId);
            var damage = calcDamage(player, rival);
            var updatedHp = rival.hp - damage;
            player.count++;
            player.speeds.push((toriTime - roundTime) / 1000);
            rival.damage += damage;

            updateHp(rival, updatedHp);
            if (rival.hp <= 0) {
                io.emit('knockout', {players: players, winner: player});
                resultMode();
            }
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

        if (yomiEndPlayersId.length === players.length || isDebug) {
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

// ダメージ計算
function calcDamage(player, rival) {
    // とりあえずいまは素直にATK分ダメージ
    return player.atk;
}

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

function resultMode() {
    mode = 'result';
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

    clearInterval(heatBeatInterval);
    heatBeatInterval = setInterval(function() {
        __.each(currentPlayersPings, function(value, key) {
            // 5秒以上pingが返ってきてなかったら接続断と判断
            if(new Date().getTime() - value > 5000) {
                debug('UserId: ' + key +'が死にました');
                io.emit('game exit');
                titleMode();
            }
        });
    }, 1000);
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
    if (mode === 'result') {
        return;
    }
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
    roundTime = new Date().getTime();
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
    currentPlayersPings = {};
    entryTimeout && clearTimeout(entryTimeout);
}

setUpGame();
server.listen(3000);
module.exports = app;
