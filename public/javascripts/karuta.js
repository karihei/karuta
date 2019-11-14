$(window).on('load', onLoad).on('beforeunload', onBeforeUnload);

var socket;
var userName = '';
var userId = -1;
var players = [];
var entryRemain = 0;
var currentPlayer; // 操作中のプレイヤー
var currentAtariId = -1; // 現ラウンドのあたり札ID
var yomiTime = 0; // 読み札が読まれた時刻
var ROW_SIZE = 3; // 列数
var MAX_DECK_SIZE = 12; // 場の札の最大数
var YOMI_INTERVAL = 500; // 一文字の読み間隔
var SHIMO_YOMI_INTERVAL = 3000; // 上の句を読み終えてから下の句を読み始めるまでの間隔
var waitingInterval;
var isOtetsuki = false; // お手つき中の場合true
var points = [0, 0]; // A, Bの総得点
var JOKA = 'なにわづに さくやこのはな ふゆごもり いまをはるべと さくやこのはな';

function onLoad() {
    initSocket();
    initViews();
    fetchGameInfo();
    startPing();
}

function startPing() {
    setInterval(function() {
        if (currentPlayer) {
            var pingData = {ping: new Date().getTime()};
            pingData['userId'] = currentPlayer.id;
            socket.emit('send ping', pingData);
        }
    }, 1000);

    socket.on('send pong', function(ping) {
        console.log(ping);
    })
}

function initSocket() {
    socket = io();
    socket.on('name entry', function(resp) {
        var ps = resp.players;
        entryRemain = resp.remain;

        if (ps.length === 0) {
            location.reload();
        }

        // ユーザIDを設定
        _.each(ps, function(player) {
            if (player.name === userName) {
                currentPlayer = player;
            }
        });

        if (ps.length === 1) {
            waitingEntryMode();
            $('#waiting_player').text(ps[0].name + 'さんが待機しています。');
        }

        players = ps.slice();
    });

    // プレイヤーが二人揃った
    socket.on('ready game', function() {
        waitingInterval && clearInterval(waitingInterval);
        alert('対戦相手が決まりました。対戦を開始します。');
        showInfoMessage('対戦相手の返事を待っています');
        socket.emit('ready to fight', currentPlayer.id);
    });

    socket.on('game start', function(resp) {
        hideInfoMessage();
        $('#container_game_board').show();
        setupPlayerInfo();
        initFuda(resp.deck);
    });

    // 序歌
    socket.on('joka start', function() {
        hideInfoMessage();
        showYomifuda(0, true);
    });

    socket.on('round start', function(resp) {
        currentAtariId = resp.atari;
        isOtetsuki = false;
        $('.hand').remove();
        $('.batsu').remove();
        $('.itoososhi_container').hide();
        hideInfoMessage();
        showYomifuda(currentAtariId);
    });

    // 誰かがあたり札を払った時
    socket.on('harai atari', function(resp) {
        var atariEl = $('.fuda#' + resp.atari);
        var player = findUserById(resp.userId);
        showHandEffect(atariEl);
        showItoososhi(player, resp.damage);
        showInfoMessage(player.name + 'さんが取りました', true);
        if(players[0].id === resp.userId) {
            atariEl.addClass('red_fuda');
        } else {
            atariEl.addClass('blue_fuda');
        }
    });

    // おてつき
    socket.on('harai otetsuki', function(resp) {
       if (currentPlayer.id === resp.userId) {
           isOtetsuki = true;
       }
        var fudaEl = $('.fuda#' + resp.atari);
        showOtetsukiEffect(fudaEl);
        showInfoMessage(findUserById(resp.userId).name + 'さんがお手つきしました', true);
    });

    socket.on('knockout', function(resp) {
        $('#result_container').show();
        $('.result_winner').text(resp.winner.name + ' WINS!');
        players = resp.players;
        var _setPlayerResult = function(el, i) {
            var speeds = players[i].speeds;
            var sum = 0;
            var speed = 999;
            _.each(speeds, function(s) {
                sum += s;
            });
            if (speeds.length > 0) {
                var ll = sum / speeds.length * 100;
                speed = Math.round(ll) / 100;
            } else {
                speed = '--';
            }
            $('.result_detail_name', el).text(players[i].name);
            $('.result_speed', el).text(speed + '秒');
            $('.result_fuda_count', el).text(players[i].count);
        };

        _setPlayerResult($('.result_red_player'), 0);
        _setPlayerResult($('.result_blue_player'), 1);
    });

    // 誰かが通信を切断した
    socket.on('game exit', function() {
        exitGame();
    });

    socket.on('update hp', function(ps) {
        updateHp(ps);
    });
}

function initViews() {
    $('#name_submit').on('click', onNameSubmit);

    waitingInterval = setInterval(function() {
        if (entryRemain > 0) {
            showInfoMessage('対戦相手を待っています:' + entryRemain--);
        } else {
            $('#entry_remain').hide();
        }
    }, 1000);
}

function fetchGameInfo() {
    socket.emit('fetch game info');
}

function initFuda(deck) {
    var rows = [];
    for (var j = 0;j < ROW_SIZE;j++) {
        var row = $('<div>').addClass('fuda_row');
        rows.push(row);
        $('#fuda_area').append(row);
    }

    var rowIndex = 0;
    for (var i = 0; i < deck.length; i++) {
        var karuta = karutaList[deck[i]];
        var sp = karuta['bodyKana'].split(' ');
        var text = sp[3] + sp[4];
        var el = $('<span>').addClass('fuda').text(text.replace(' ', '')).attr('id', deck[i]);
        el.on('touchstart', onFudaTap);
        rows[rowIndex].append(el);
        var width = el.width();
        el.css({left: i * width});
        el.height(width * 1.618);
        el.jrumble({
            x: 10,
            y: 10,
            rotation: 4
        });

        if ((i+1) % (deck.length / ROW_SIZE) === 0) {
            rowIndex++;
        }
    }
}

// プレイヤー名やHPなどの情報を要素にセットする
function setupPlayerInfo() {
    if (players.length !== 2) {
        return
    }

    var _setPlayerInfo = function(el, i) {
        $(el).addClass('pid-' + players[i].id);
        $('.player_name', el).text(players[i].name);
        $('.player_hp_value', el).text(players[i].hp);
    };

    _setPlayerInfo($('.red_player'), 0);
    _setPlayerInfo($('.blue_player'), 1);
}

function onBeforeUnload() {
    if (currentPlayer && currentPlayer.id >= 0) {
        socket.emit('user exit', currentPlayer.id);
    }
}

function onNameSubmit(e) {
    e.preventDefault();
    var nameEl = $('#name_input');
    userName = nameEl.val();
    $('.title').css({'width': '30%'});
    if (userName.length > 0) {
        $('#container_login').hide();
        socket.emit('name entry', userName);
    }
}

function onFudaTap(e) {
    if (isOtetsuki) {
        showInfoMessage('お手つき中です。', true);
    } else {
        var toriId = $(e.target).attr('id');
        var responceTime = new Date().getTime() - yomiTime;
        socket.emit('harai', {atari: parseInt(toriId), responceTime: responceTime, userId: currentPlayer.id});
    }
}

function showHandEffect(el) {
    el.trigger('startRumble');
    setTimeout(function() {
        el.trigger('stopRumble');
    }, 200);

    var handImg = $('<img>').addClass('hand').attr('src', '/images/hand.png');
    el.append(handImg);
    handImg.animate({'width': '130%', 'opacity': 0.7}, 300);
}

function showItoososhi(p, damage) {
    var is1P = players[0].id === p.id;
    $('.itoososhi_container').show();
    var winner = is1P ? 'red' : 'blue';
    var looser = is1P ? 'blue' : 'red';
    $('.itoososhi_' +  winner + '_player').show();
    $('.itoososhi_' +  looser + '_player').hide();
    $('.itoososhi_damage').text(damage + '!');
}

function showOtetsukiEffect(el) {
    el.trigger('startRumble');
    setTimeout(function() {
        el.trigger('stopRumble');
    }, 200);
    var batsuImg = $('<img>').addClass('batsu').attr('src', '/images/batsu.png');
    el.append(batsuImg);
}

function showYomifuda(index, opt_joka) {
    $('.yomi_container').css('opacity', 0).animate({'opacity': 1}, 300);
    yomiTime = new Date().getTime();
    var sp = opt_joka ? JOKA.split(' ') : karutaList[index]['bodyKana'].split(' ');
    var kaminoku = sp[0] + ' ' + sp[1] + ' ' + sp[2];
    var shimonoku = sp[3] + ' ' + sp[4];
    var kaminokuEl = $('#kaminoku');
    var shimonokuEl = $('#shimonoku');
    kaminokuEl.text('');
    shimonokuEl.text('');

    var totalCount = 0;
    var count = 0;

    var time = function() {
        if (totalCount <= kaminoku.length) {
            kaminokuEl.text(kaminoku.substring(0, count++));
            if (totalCount === kaminoku.length) {
                count = 0;
            }
        } else {
            shimonokuEl.text(shimonoku.substring(0, count++));
        }
        var timer;
        if (count === 0) {
            timer = window.setTimeout(time, SHIMO_YOMI_INTERVAL);
        } else {
            timer = window.setTimeout(time, YOMI_INTERVAL);
        }

        if (totalCount > kaminoku.length + shimonoku.length) {
            clearTimeout(timer);
            $('.yomi_container').animate({'opacity': 0}, 4000);
            setTimeout(function() {
                socket.emit('yomi end', currentPlayer.id);
            }, 5000);
        } else {
            totalCount++;
        }
    };

    time();
}

function waitingEntryMode() {
    showInfoMessage('対戦相手を待っています。', true)
    $('#waiting_container').show();
}

function showInfoMessage(text, opt_animate) {
    var el = $('#msg_info');
    el.css({'opacity': 1}).text(text);
    if (opt_animate) {
        el.css({'padding': 0, 'opacity': 1}).animate({'padding': 30}, 100);
    }
}

function hideInfoMessage() {
    $('#msg_info').animate({'opacity': 0}, 100);
    $('#waiting_container').hide();
}

function updateHp(updatedPlayers) {
    _.each(updatedPlayers, function(updatedPlayer) {
        var player_ = findUserById(updatedPlayer.id);
        if (player_) {
            var amount = updatedPlayer.hp - player_.hp;
            hpEffect(updatedPlayer, amount);
        }
    });
    players = _.clone(updatedPlayers);
}

function hpEffect(player, amount) {
    var el = $('.pid-' + player.id);
    var ratio = Math.ceil(player.hp / player.maxHp * 100);
    if (amount === 0 ) {
        return;
    } else if(amount < 0) {
        // ダメージ
        $('.player_hp_value', el).text(player.hp);
        $('.hpbar_inner', el).animate({'width': ratio + '%'}, 300, 'swing', function() {
            if (player.hp <= 0) {
                $('.hpbar_inner', el).hide();
            }

        });
    } else {
        // 回復
    }
}

function findUserById(id) {
    return _.find(players, function(player) {
        return player.id === id;
    });
}

function exitGame() {
    alert('通信が切断されました。ゲームを終了します。');
    location.reload();
}

var karutaList = [{"n":1,"bodyKanji":"秋の田の かりほの庵の 苫をあらみ 我が衣手は 露にぬれつつ","bodyKana":"あきのたの かりほのいほの とまをあらみ わがころもでは つゆにぬれつつ","nameKanji":"天智天皇","nameKana":"てんじてんのう","kimariji":"あきの","imageWref":"ファイル:Hyakuninisshu_001.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/0/04/Hyakuninisshu_001.jpg"},{"n":2,"bodyKanji":"春過ぎて 夏来にけらし 白妙の 衣ほすてふ 天の香具山","bodyKana":"はるすぎて なつきにけらし しろたへの ころもほすてふ あまのかぐやま","nameKanji":"持統天皇","nameKana":"じとうてんのう","kimariji":"はるす","imageWref":"ファイル:Hyakuninisshu_002.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/9/95/Hyakuninisshu_002.jpg"},{"n":3,"bodyKanji":"あしびきの 山鳥の尾の しだり尾の ながながし夜を ひとりかも寝む","bodyKana":"あしびきの やまどりのをの しだりをの ながながしよを ひとりかもねむ","nameKanji":"柿本人麻呂","nameKana":"かきのもとのひとまろ","kimariji":"あし","imageWref":"ファイル:Hyakuninisshu_003.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/f/f6/Hyakuninisshu_003.jpg"},{"n":4,"bodyKanji":"田子の浦に うちいでてみれば 白妙の 富士の高嶺に 雪は降りつつ","bodyKana":"たごのうらに うちいでてみれば しろたへの ふじのたかねに ゆきはふりつつ","nameKanji":"山部赤人","nameKana":"やまべのあかひと","kimariji":"たご","imageWref":"ファイル:Hyakuninisshu_004.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/3/37/Hyakuninisshu_004.jpg"},{"n":5,"bodyKanji":"奥山に もみぢふみわけ なく鹿の 声聞く時ぞ 秋はかなしき","bodyKana":"おくやまに もみぢふみわけ なくしかの こゑきくときぞ あきはかなしき","nameKanji":"猿丸太夫","nameKana":"さるまるだゆう","kimariji":"おく","imageWref":"ファイル:Hyakuninisshu_005.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/c/cd/Hyakuninisshu_005.jpg"},{"n":6,"bodyKanji":"かささぎの 渡せる橋に おく霜の 白きをみれば 夜ぞふけにける","bodyKana":"かささぎの わたせるはしに おくしもの しろきをみれば よぞふけにける","nameKanji":"中納言家持","nameKana":"ちゅうなごんやかもち","kimariji":"かさ","imageWref":"ファイル:Hyakuninisshu_006.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/f/fe/Hyakuninisshu_006.jpg"},{"n":7,"bodyKanji":"天の原 ふりさけみれば 春日なる 三笠の山に いでし月かも","bodyKana":"あまのはら ふりさけみれば かすがなる みかさのやまに いでしつきかも","nameKanji":"阿倍仲麻呂","nameKana":"あべのなかまろ","kimariji":"あまの","imageWref":"ファイル:Hyakuninisshu_007.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/4/46/Hyakuninisshu_007.jpg"},{"n":8,"bodyKanji":"わが庵は 都のたつみ しかぞすむ 世をうぢ山と 人はいふなり","bodyKana":"わがいほは みやこのたつみ しかぞすむ よをうぢやまと ひとはいふなり","nameKanji":"喜撰法師","nameKana":"きせんほうし","kimariji":"わがい","imageWref":"ファイル:Hyakuninisshu_008.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/d/d0/Hyakuninisshu_008.jpg"},{"n":9,"bodyKanji":"花の色は うつりにけりな いたづらに わが身よにふる ながめせしまに","bodyKana":"はなのいろは うつりにけりな いたづらに わがみよにふる ながめせしまに","nameKanji":"小野小町","nameKana":"おののこまち","kimariji":"はなの","imageWref":"ファイル:Hyakuninisshu_009.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/9/94/Hyakuninisshu_009.jpg"},{"n":10,"bodyKanji":"これやこの 行くも帰るも わかれては しるもしらぬも 逢坂の関","bodyKana":"これやこの ゆくもかへるも わかれては しるもしらぬも あふさかのせき","nameKanji":"蝉丸","nameKana":"せみまる","kimariji":"これ","imageWref":"ファイル:Hyakuninisshu_010.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/2/29/Hyakuninisshu_010.jpg"},{"n":11,"bodyKanji":"わたの原 八十島かけて こぎいでぬと 人にはつげよ あまのつり舟","bodyKana":"わたのはら やそしまかけて こぎいでぬと ひとにはつげよ あまのつりぶね","nameKanji":"参議篁","nameKana":"さんぎたかむら","kimariji":"わたのはら や","imageWref":"ファイル:Hyakuninisshu_011.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/7/7e/Hyakuninisshu_011.jpg"},{"n":12,"bodyKanji":"天つ風 雲のかよひ路 吹きとぢよ をとめの姿 しばしとどめむ","bodyKana":"あまつかぜ くものかよひぢ ふきとぢよ をとめのすがた しばしとどめむ","nameKanji":"僧正遍昭","nameKana":"そうじょうへんじょう","kimariji":"あまつ","imageWref":"ファイル:Hyakuninisshu_012.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/b/b4/Hyakuninisshu_012.jpg"},{"n":13,"bodyKanji":"つくばねの 峰よりおつる みなの川 恋ぞつもりて 淵となりぬる","bodyKana":"つくばねの みねよりおつる みなのがは こひぞつもりて ふちとなりぬる","nameKanji":"陽成院","nameKana":"ようぜいいん","kimariji":"つく","imageWref":"ファイル:Hyakuninisshu_013.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/8/85/Hyakuninisshu_013.jpg"},{"n":14,"bodyKanji":"みちのくの しのぶもぢずり 誰ゆゑに みだれそめにし 我ならなくに","bodyKana":"みちのくの しのぶもぢずり たれゆゑに みだれそめにし われならなくに","nameKanji":"河原左大臣","nameKana":"かわらのさだいじん","kimariji":"みち","imageWref":"ファイル:Hyakuninisshu_014.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/9/94/Hyakuninisshu_014.jpg"},{"n":15,"bodyKanji":"君がため 春の野に出でて 若菜つむ わが衣手に 雪はふりつつ","bodyKana":"きみがため はるののにいでて わかなつむ わがころもでに ゆきはふりつつ","nameKanji":"光孝天皇","nameKana":"こうこうてんのう","kimariji":"きみがため は","imageWref":"ファイル:Hyakuninisshu_015.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/0/05/Hyakuninisshu_015.jpg"},{"n":16,"bodyKanji":"立ちわかれ いなばの山の 峰に生ふる まつとし聞かば いまかへりこむ","bodyKana":"たちわかれ いなばのやまの みねにおふる まつとしきかば いまかへりこむ","nameKanji":"中納言行平","nameKana":"ちゅうなごんゆきひら","kimariji":"たち","imageWref":"ファイル:Hyakuninisshu_016.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/8/8b/Hyakuninisshu_016.jpg"},{"n":17,"bodyKanji":"ちはやぶる 神代もきかず 竜田川 からくれなゐに 水くくるとは","bodyKana":"ちはやぶる かみよもきかず たつたがは からくれなゐに みづくくるとは","nameKanji":"在原業平朝臣","nameKana":"ありわらのなりひらあそん","kimariji":"ちは","imageWref":"ファイル:Hyakuninisshu_017.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/2/2c/Hyakuninisshu_017.jpg"},{"n":18,"bodyKanji":"住の江の 岸による波 よるさへや 夢のかよひ路 人目よくらむ","bodyKana":"すみのえの きしによるなみ よるさへや ゆめのかよひぢ ひとめよくらむ","nameKanji":"藤原敏行朝臣","nameKana":"ふじわらのとしゆきあそん","kimariji":"す","imageWref":"ファイル:Hyakuninisshu_018.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/c/c6/Hyakuninisshu_018.jpg"},{"n":19,"bodyKanji":"難波潟 みじかき蘆の ふしのまも あはでこの世を すぐしてよとや","bodyKana":"なにはがた みじかきあしの ふしのまも あはでこのよを すぐしてよとや","nameKanji":"伊勢","nameKana":"いせ","kimariji":"なにはが","imageWref":"ファイル:Hyakuninisshu_019.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/8/85/Hyakuninisshu_019.jpg"},{"n":20,"bodyKanji":"わびぬれば いまはたおなじ 難波なる 身をつくしても あはむとぞ思ふ","bodyKana":"わびぬれば いまはたおなじ なにはなる みをつくしても あはむとぞおもふ","nameKanji":"元良親王","nameKana":"もとよししんのう","kimariji":"わび","imageWref":"ファイル:Hyakuninisshu_020.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/9/97/Hyakuninisshu_020.jpg"},{"n":21,"bodyKanji":"今こむと いひしばかりに 長月の 有明の月を まちいでつるかな","bodyKana":"いまこむと いひしばかりに ながつきの ありあけのつきを まちいでつるかな","nameKanji":"素性法師","nameKana":"そせいほうし","kimariji":"いまこ","imageWref":"ファイル:Hyakuninisshu_021.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/3/3b/Hyakuninisshu_021.jpg"},{"n":22,"bodyKanji":"吹くからに 秋の草木の しをるれば むべ山風を 嵐といふらむ","bodyKana":"ふくからに あきのくさきの しをるれば むべやまかぜを あらしといふらむ","nameKanji":"文屋康秀","nameKana":"ふんやのやすひで","kimariji":"ふ","imageWref":"ファイル:Hyakuninisshu_022.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/1/11/Hyakuninisshu_022.jpg"},{"n":23,"bodyKanji":"月みれば ちぢにものこそ かなしけれ わが身一つの 秋にはあらねど","bodyKana":"つきみれば ちぢにものこそ かなしけれ わがみひとつの あきにはあらねど","nameKanji":"大江千里","nameKana":"おおえのちさと","kimariji":"つき","imageWref":"ファイル:Hyakuninisshu_023.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/e/e4/Hyakuninisshu_023.jpg"},{"n":24,"bodyKanji":"このたびは ぬさもとりあへず 手向山 もみぢのにしき 神のまにまに","bodyKana":"このたびは ぬさもとりあへず たむけやま もみぢのにしき かみのまにまに","nameKanji":"菅家","nameKana":"かんけ","kimariji":"この","imageWref":"ファイル:Hyakuninisshu_024.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/0/01/Hyakuninisshu_024.jpg"},{"n":25,"bodyKanji":"名にし負はば 逢坂山の さねかづら 人にしられで 来るよしもがな","bodyKana":"なにしおはば あふさかやまの さねかづら ひとにしられで くるよしもがな","nameKanji":"三条右大臣","nameKana":"さんじょうのうだいじん","kimariji":"なにし","imageWref":"ファイル:Hyakuninisshu_025.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/d/d2/Hyakuninisshu_025.jpg"},{"n":26,"bodyKanji":"小倉山 峰のもみぢ葉 心あらば いまひとたびの みゆきまたなむ","bodyKana":"をぐらやま みねのもみぢば こころあらば いまひとたびの みゆきまたなむ","nameKanji":"貞信公","nameKana":"ていしんこう","kimariji":"をぐ","imageWref":"ファイル:Hyakuninisshu_026.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/b/b4/Hyakuninisshu_026.jpg"},{"n":27,"bodyKanji":"みかの原 わきて流るる いづみ川 いつみきとてか 恋しかるらむ","bodyKana":"みかのはら わきてながるる いづみがは いつみきとてか こひしかるらむ","nameKanji":"中納言兼輔","nameKana":"ちゅうなごんかねすけ","kimariji":"みかの","imageWref":"ファイル:Hyakuninisshu_027.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/7/7b/Hyakuninisshu_027.jpg"},{"n":28,"bodyKanji":"山里は 冬ぞさびしさ まさりける 人目も草も かれぬと思へば","bodyKana":"やまざとは ふゆぞさびしさ まさりける ひとめもくさも かれぬとおもへば","nameKanji":"源宗行朝臣","nameKana":"みなもとのむねゆきあそん","kimariji":"やまざ","imageWref":"ファイル:Hyakuninisshu_028.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/a/af/Hyakuninisshu_028.jpg"},{"n":29,"bodyKanji":"心当てに 折らばや折らむ 初霜の おきまどはせる 白菊の花","bodyKana":"こころあてに をらばやをらむ はつしもの おきまどはせる しらぎくのはな","nameKanji":"凡河内躬恒","nameKana":"おおしこうちのみつね","kimariji":"こころあ","imageWref":"ファイル:Hyakuninisshu_029.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/c/cf/Hyakuninisshu_029.jpg"},{"n":30,"bodyKanji":"有明の つれなく見えし 別れより あかつきばかり うきものはなし","bodyKana":"ありあけの つれなくみえし わかれより あかつきばかり うきものはなし","nameKanji":"壬生忠岑","nameKana":"みぶのただみね","kimariji":"ありあ","imageWref":"ファイル:Hyakuninisshu_030.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/8/8a/Hyakuninisshu_030.jpg"},{"n":31,"bodyKanji":"朝ぼらけ 有明の月と見るまでに 吉野の里に 降れる白雪","bodyKana":"あさぼらけ ありあけのつきと みるまでに よしののさとに ふれるしらゆき","nameKanji":"坂上是則","nameKana":"さかのうえのこれのり","kimariji":"あさぼらけ あ","imageWref":"ファイル:Hyakuninisshu_031.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/c/ce/Hyakuninisshu_031.jpg"},{"n":32,"bodyKanji":"山川に 風のかけたる しがらみは ながれもあへぬ もみぢなりけり","bodyKana":"やまがはに かぜのかけたる しがらみは ながれもあへぬ もみぢなりけり","nameKanji":"春道列樹","nameKana":"はるみちのつらき","kimariji":"やまが","imageWref":"ファイル:Hyakuninisshu_032.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/a/a6/Hyakuninisshu_032.jpg"},{"n":33,"bodyKanji":"久方の 光のどけき 春の日に しづ心なく 花の散るらむ","bodyKana":"ひさかたの ひかりのどけき はるのひに しづこころなく はなのちるらむ","nameKanji":"紀友則","nameKana":"きのとものり","kimariji":"ひさ","imageWref":"ファイル:Hyakuninisshu_033.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/e/ef/Hyakuninisshu_033.jpg"},{"n":34,"bodyKanji":"誰をかも しる人にせむ 高砂の 松も昔の 友ならなくに","bodyKana":"たれをかも しるひとにせむ たかさごの まつもむかしの ともならなくに","nameKanji":"藤原興風","nameKana":"ふじわらのおきかぜ","kimariji":"たれ","imageWref":"ファイル:Hyakuninisshu_034.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/f/f6/Hyakuninisshu_034.jpg"},{"n":35,"bodyKanji":"人はいさ 心も知らず ふるさとは 花ぞ昔の 香に匂ひける","bodyKana":"ひとはいさ こころもしらず ふるさとは はなぞむかしの かににほひける","nameKanji":"紀貫之","nameKana":"きのつらゆき","kimariji":"ひとは","imageWref":"ファイル:Hyakuninisshu_035.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/3/32/Hyakuninisshu_035.jpg"},{"n":36,"bodyKanji":"夏の夜は まだ宵ながら あけぬるを 雲のいづこに 月やどるらむ","bodyKana":"なつのよは まだよひながら あけぬるを くものいづこに つきやどるらむ","nameKanji":"清原深養父","nameKana":"きよはらのふかやぶ","kimariji":"なつ","imageWref":"ファイル:Hyakuninisshu_036.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/f/f7/Hyakuninisshu_036.jpg"},{"n":37,"bodyKanji":"白露に 風の吹きしく 秋の野は つらぬきとめぬ 玉ぞ散りける","bodyKana":"しらつゆに かぜのふきしく あきののは つらぬきとめぬ たまぞちりける","nameKanji":"文屋朝康","nameKana":"ふんやのあさやす","kimariji":"しら","imageWref":"ファイル:Hyakuninisshu_037.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/c/c5/Hyakuninisshu_037.jpg"},{"n":38,"bodyKanji":"忘らるる 身をば思はず ちかひてし 人の命の 惜しくもあるかな","bodyKana":"わすらるる みをばおもはず ちかひてし ひとのいのちの をしくもあるかな","nameKanji":"右近","nameKana":"うこん","kimariji":"わすら","imageWref":"ファイル:Hyakuninisshu_038.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/a/a5/Hyakuninisshu_038.jpg"},{"n":39,"bodyKanji":"浅茅生の 小野の篠原 しのぶれど あまりてなどか 人の恋しき","bodyKana":"あさぢふの をののしのはら しのぶれど あまりてなどか ひとのこひしき","nameKanji":"参議等","nameKana":"さんぎひとし","kimariji":"あさぢ","imageWref":"ファイル:Hyakuninisshu_039.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/7/7b/Hyakuninisshu_039.jpg"},{"n":40,"bodyKanji":"しのぶれど 色に出でにけり 我が恋は 物や思ふと 人の問ふまで","bodyKana":"しのぶれど いろにいでにけり わがこひは ものやおもふと ひとのとふまで","nameKanji":"平兼盛","nameKana":"たいらのかねもり","kimariji":"しの","imageWref":"ファイル:Hyakuninisshu_040.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/7/7b/Hyakuninisshu_040.jpg"},{"n":41,"bodyKanji":"恋すてふ 我が名はまだき 立ちにけり 人しれずこそ 思ひそめしか","bodyKana":"こひすてふ わがなはまだき たちにけり ひとしれずこそ おもひそめしか","nameKanji":"壬生忠見","nameKana":"みぶのただみ","kimariji":"こひ","imageWref":"ファイル:Hyakuninisshu_041.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/6/61/Hyakuninisshu_041.jpg"},{"n":42,"bodyKanji":"ちぎりきな かたみに袖を しぼりつつ 末の松山 波こさじとは","bodyKana":"ちぎりきな かたみにそでを しぼりつつ すゑのまつやま なみこさじとは","nameKanji":"清原元輔","nameKana":"きよはらのもとすけ","kimariji":"ちぎりき","imageWref":"ファイル:Hyakuninisshu_042.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/5/54/Hyakuninisshu_042.jpg"},{"n":43,"bodyKanji":"あひみての のちの心に くらぶれば 昔は物を 思はざりけり","bodyKana":"あひみての のちのこころに くらぶれば むかしはものを おもはざりけり","nameKanji":"権中納言敦忠","nameKana":"ごんちゅうなごんあつただ","kimariji":"あひ","imageWref":"ファイル:Hyakuninisshu_043.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/2/2a/Hyakuninisshu_043.jpg"},{"n":44,"bodyKanji":"あふことの たえてしなくば なかなかに 人をも身をも 恨みざらまし","bodyKana":"あふことの たえてしなくば なかなかに ひとをもみをも うらみざらまし","nameKanji":"中納言朝忠","nameKana":"ちゅうなごんあさただ","kimariji":"あふこ","imageWref":"ファイル:Hyakuninisshu_044.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/2/2c/Hyakuninisshu_044.jpg"},{"n":45,"bodyKanji":"あはれとも いふべき人は 思ほえで 身のいたづらに なりぬべきかな","bodyKana":"あはれとも いふべきひとは おもほえで みのいたづらに なりぬべきかな","nameKanji":"謙徳公","nameKana":"けんとくこう","kimariji":"あはれ","imageWref":"ファイル:Hyakuninisshu_045.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/4/40/Hyakuninisshu_045.jpg"},{"n":46,"bodyKanji":"由良のとを 渡る舟人 かぢをたえ ゆくへも知らぬ 恋の道かな","bodyKana":"ゆらのとを わたるふなびと かぢをたえ ゆくへもしらぬ こひのみちかな","nameKanji":"曽禰好忠","nameKana":"そねのよしただ","kimariji":"ゆら","imageWref":"ファイル:Hyakuninisshu_046.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/5/5a/Hyakuninisshu_046.jpg"},{"n":47,"bodyKanji":"八重むぐら しげれる宿の さびしきに 人こそ見えね 秋は来にけり","bodyKana":"やへむぐら しげれるやどの さびしきに ひとこそみえね あきはきにけり","nameKanji":"恵慶法師","nameKana":"えぎょうほうし","kimariji":"やへ","imageWref":"ファイル:Hyakuninisshu_047.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/0/0f/Hyakuninisshu_047.jpg"},{"n":48,"bodyKanji":"風をいたみ 岩うつ波の おのれのみ くだけて物を 思ふころかな","bodyKana":"かぜをいたみ いはうつなみの おのれのみ くだけてものを おもふころかな","nameKanji":"源重之","nameKana":"みなもとのしげゆき","kimariji":"かぜを","imageWref":"ファイル:Hyakuninisshu_048.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/9/97/Hyakuninisshu_048.jpg"},{"n":49,"bodyKanji":"みかきもり 衛士のたく火の 夜はもえ 昼は消えつつ 物をこそ思へ","bodyKana":"みかきもり ゑじのたくひの よるはもえ ひるはきえつつ ものをこそおもへ","nameKanji":"大中臣能宣朝臣","nameKana":"おおなかとみのよしのぶあそん","kimariji":"みかき","imageWref":"ファイル:Hyakuninisshu_049.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/b/b8/Hyakuninisshu_049.jpg"},{"n":50,"bodyKanji":"君がため 惜しからざりし いのちさへ 長くもがなと 思ひけるかな","bodyKana":"きみがため をしからざりし いのちさへ ながくもがなと おもひけるかな","nameKanji":"藤原義孝","nameKana":"ふじわらのよしたか","kimariji":"きみがため を","imageWref":"ファイル:Hyakuninisshu_050.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/8/85/Hyakuninisshu_050.jpg"},{"n":51,"bodyKanji":"かくとだに えやはいぶきの さしも草 さしもしらじな もゆる思ひを","bodyKana":"かくとだに えやはいぶきの さしもぐさ さしもしらじな もゆるおもひを","nameKanji":"藤原実方朝臣","nameKana":"ふじわらのさねかたあそん","kimariji":"かく","imageWref":"ファイル:Hyakuninisshu_051.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/4/48/Hyakuninisshu_051.jpg"},{"n":52,"bodyKanji":"あけぬれば 暮るるものとは 知りながら なほうらめしき 朝ぼらけかな","bodyKana":"あけぬれば くるるものとは しりながら なほうらめしき あさぼらけかな","nameKanji":"藤原道信朝臣","nameKana":"ふじわらのみちのぶあそん","kimariji":"あけ","imageWref":"ファイル:Hyakuninisshu_052.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/0/08/Hyakuninisshu_052.jpg"},{"n":53,"bodyKanji":"なげきつつ ひとりぬる夜の あくるまは いかに久しき ものとかはしる","bodyKana":"なげきつつ ひとりぬるよの あくるまは いかにひさしき ものとかはしる","nameKanji":"右大将道綱母","nameKana":"うだいしょうみちつなのはは","kimariji":"なげき","imageWref":"ファイル:Hyakuninisshu_053.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/0/02/Hyakuninisshu_053.jpg"},{"n":54,"bodyKanji":"忘れじの ゆく末までは かたければ 今日をかぎりの いのちともがな","bodyKana":"わすれじの ゆくすゑまでは かたければ けふをかぎりの いのちともがな","nameKanji":"儀同三司母","nameKana":"ぎどうさんしのはは","kimariji":"わすれ","imageWref":"ファイル:Hyakuninisshu_054.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/a/a0/Hyakuninisshu_054.jpg"},{"n":55,"bodyKanji":"滝の音は たえて久しく なりぬれど 名こそ流れて なほ聞こえけれ","bodyKana":"たきのおとは たえてひさしく なりぬれど なこそながれて なほきこえけれ","nameKanji":"大納言公任","nameKana":"だいなごんきんとう","kimariji":"たき","imageWref":"ファイル:Hyakuninisshu_055.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/3/31/Hyakuninisshu_055.jpg"},{"n":56,"bodyKanji":"あらざらむ この世のほかの 思ひ出に いまひとたびの あふこともがな","bodyKana":"あらざらむ このよのほかの おもひでに いまひとたびの あふこともがな","nameKanji":"和泉式部","nameKana":"いずみしきぶ","kimariji":"あらざ","imageWref":"ファイル:Hyakuninisshu_056.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/9/99/Hyakuninisshu_056.jpg"},{"n":57,"bodyKanji":"めぐりあひて 見しやそれとも わかぬまに 雲がくれにし 夜半の月かな","bodyKana":"めぐりあひて みしやそれとも わかぬまに くもがくれにし よはのつきかな","nameKanji":"紫式部","nameKana":"むらさきしきぶ","kimariji":"め","imageWref":"ファイル:Hyakuninisshu_057.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/1/13/Hyakuninisshu_057.jpg"},{"n":58,"bodyKanji":"ありま山 ゐなの笹原 風吹けば いでそよ人を 忘れやはする","bodyKana":"ありまやま ゐなのささはら かぜふけば いでそよひとを わすれやはする","nameKanji":"大弐三位","nameKana":"だいにのさんみ","kimariji":"ありま","imageWref":"ファイル:Hyakuninisshu_058.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/7/71/Hyakuninisshu_058.jpg"},{"n":59,"bodyKanji":"やすらはで 寝なましものを さ夜ふけて かたぶくまでの 月を見しかな","bodyKana":"やすらはで ねなましものを さよふけて かたぶくまでの つきをみしかな","nameKanji":"赤染衛門","nameKana":"あかぞめえもん","kimariji":"やす","imageWref":"ファイル:Hyakuninisshu_059.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/0/0f/Hyakuninisshu_059.jpg"},{"n":60,"bodyKanji":"大江山 いく野の道の 遠ければ まだふみもみず 天の橋立","bodyKana":"おほえやま いくののみちの とほければ まだふみもみず あまのはしだて","nameKanji":"小式部内侍","nameKana":"こしきぶのないし","kimariji":"おほえ","imageWref":"ファイル:Hyakuninisshu_060.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/a/ae/Hyakuninisshu_060.jpg"},{"n":61,"bodyKanji":"いにしへの 奈良の都の 八重桜 けふ九重に 匂ひぬるかな","bodyKana":"いにしへの ならのみやこの やへざくら けふここのへに にほひぬるかな","nameKanji":"伊勢大輔","nameKana":"いせのたいふ","kimariji":"いに","imageWref":"ファイル:Hyakuninisshu_061.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/f/fb/Hyakuninisshu_061.jpg"},{"n":62,"bodyKanji":"夜をこめて 鳥のそらねは はかるとも よに逢坂の 関はゆるさじ","bodyKana":"よをこめて とりのそらねは はかるとも よにあふさかの せきはゆるさじ","nameKanji":"清少納言","nameKana":"せいしょうなごん","kimariji":"よを","imageWref":"ファイル:Hyakuninisshu_062.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/d/d7/Hyakuninisshu_062.jpg"},{"n":63,"bodyKanji":"いまはただ 思ひ絶えなむ とばかりを 人づてならで 言ふよしもがな","bodyKana":"いまはただ おもひたえなむ とばかりを ひとづてならで いふよしもがな","nameKanji":"左京大夫道雅","nameKana":"さきょうのだいぶみちまさ","kimariji":"いまは","imageWref":"ファイル:Hyakuninisshu_063.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/b/be/Hyakuninisshu_063.jpg"},{"n":64,"bodyKanji":"朝ぼらけ 宇治の川霧 絶え絶えに あらはれわたる 瀬々の網代木","bodyKana":"あさぼらけ うぢのかはぎり たえだえに あらはれわたる せぜのあじろぎ","nameKanji":"権中納言定頼","nameKana":"ごんちゅうなごんさだより","kimariji":"あさぼらけ う","imageWref":"ファイル:Hyakuninisshu_064.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/2/25/Hyakuninisshu_064.jpg"},{"n":65,"bodyKanji":"うらみわび ほさぬ袖だに あるものを 恋にくちなむ 名こそをしけれ","bodyKana":"うらみわび ほさぬそでだに あるものを こひにくちなむ なこそをしけれ","nameKanji":"相模","nameKana":"さがみ","kimariji":"うら","imageWref":"ファイル:Hyakuninisshu_065.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/5/51/Hyakuninisshu_065.jpg"},{"n":66,"bodyKanji":"もろともに あはれと思へ 山桜 花よりほかに 知る人もなし","bodyKana":"もろともに あはれとおもへ やまざくら はなよりほかに しるひともなし","nameKanji":"前大僧正行尊","nameKana":"さきのだいそうじょうぎょうそん","kimariji":"もろ","imageWref":"ファイル:Hyakuninisshu_066.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/2/26/Hyakuninisshu_066.jpg"},{"n":67,"bodyKanji":"春の夜の 夢ばかりなる 手枕に かひなくたたむ 名こそをしけれ","bodyKana":"はるのよの ゆめばかりなる たまくらに かひなくたたむ なこそをしけれ","nameKanji":"周防内侍","nameKana":"すおうのないし","kimariji":"はるの","imageWref":"ファイル:Hyakuninisshu_067.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/9/93/Hyakuninisshu_067.jpg"},{"n":68,"bodyKanji":"心にも あらでうき世に ながらへば 恋しかるべき 夜半の月かな","bodyKana":"こころにも あらでうきよに ながらへば こひしかるべき よはのつきかな","nameKanji":"三条院","nameKana":"さんじょういん","kimariji":"こころに","imageWref":"ファイル:Hyakuninisshu_068.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/0/0e/Hyakuninisshu_068.jpg"},{"n":69,"bodyKanji":"あらし吹く み室の山の もみぢばは 竜田の川の 錦なりけり","bodyKana":"あらしふく みむろのやまの もみぢばは たつたのかはの にしきなりけり","nameKanji":"能因法師","nameKana":"のういんほうし","kimariji":"あらし","imageWref":"ファイル:Hyakuninisshu_069.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/d/d9/Hyakuninisshu_069.jpg"},{"n":70,"bodyKanji":"さびしさに 宿を立ち出でて ながむれば いづくもおなじ 秋の夕ぐれ","bodyKana":"さびしさに やどをたちいでて ながむれば いづくもおなじ あきのゆふぐれ","nameKanji":"良選法師","nameKana":"りょうぜんほうし","kimariji":"さ","imageWref":"ファイル:Hyakuninisshu_070.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/7/75/Hyakuninisshu_070.jpg"},{"n":71,"bodyKanji":"夕されば 門田の稲葉 おとづれて 蘆のまろやに 秋風ぞ吹く","bodyKana":"ゆふされば かどたのいなば おとづれて あしのまろやに あきかぜぞふく","nameKanji":"大納言経信","nameKana":"だいなごんつねのぶ","kimariji":"ゆふ","imageWref":"ファイル:Hyakuninisshu_071.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/1/1b/Hyakuninisshu_071.jpg"},{"n":72,"bodyKanji":"音に聞く 高師の浜の あだ波は かけじや袖の ぬれもこそすれ","bodyKana":"おとにきく たかしのはまの あだなみは かけじやそでの ぬれもこそすれ","nameKanji":"祐子内親王家紀伊","nameKana":"ゆうしないしんのうけのきい","kimariji":"おと","imageWref":"ファイル:Hyakuninisshu_072.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/2/2b/Hyakuninisshu_072.jpg"},{"n":73,"bodyKanji":"高砂の をのへのさくら さきにけり とやまのかすみ たたずもあらなむ","bodyKana":"たかさごの をのへのさくら さきにけり とやまのかすみ たたずもあらなむ","nameKanji":"前権中納言匡房","nameKana":"さきのごんちゅうなごんまさふさ","kimariji":"たか","imageWref":"ファイル:Hyakuninisshu_073.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/a/a2/Hyakuninisshu_073.jpg"},{"n":74,"bodyKanji":"憂かりける 人を初瀬の 山おろしよ はげしかれとは 祈らぬものを","bodyKana":"うかりける ひとをはつせの やまおろしよ はげしかれとは いのらぬものを","nameKanji":"源俊頼朝臣","nameKana":"みなもとのとしよりあそん","kimariji":"うか","imageWref":"ファイル:Hyakuninisshu_074.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/0/00/Hyakuninisshu_074.jpg"},{"n":75,"bodyKanji":"ちぎりおきし させもが露を いのちにて あはれ今年の 秋もいぬめり","bodyKana":"ちぎりおきし させもがつゆを いのちにて あはれことしの あきもいぬめり","nameKanji":"藤原基俊","nameKana":"ふじわらのもととし","kimariji":"ちぎりお","imageWref":"ファイル:Hyakuninisshu_075.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/5/55/Hyakuninisshu_075.jpg"},{"n":76,"bodyKanji":"わたの原 こぎいでてみれば 久方の 雲いにまがふ 沖つ白波","bodyKana":"わたのはら こぎいでてみれば ひさかたの くもゐにまがふ おきつしらなみ","nameKanji":"法性寺入道前関白太政大臣","nameKana":"ほつしょうじにゅうどうさきの かんぱくだいじょうだいじん","kimariji":"わたのはら こ","imageWref":"ファイル:Hyakuninisshu_076.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/d/da/Hyakuninisshu_076.jpg"},{"n":77,"bodyKanji":"瀬をはやみ 岩にせかるる 滝川の われても末に あはむとぞ思ふ","bodyKana":"せをはやみ いはにせかるる たきがはの われてもすゑに あはむとぞおもふ","nameKanji":"崇徳院","nameKana":"すとくいん","kimariji":"せ","imageWref":"ファイル:Hyakuninisshu_077.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/e/e2/Hyakuninisshu_077.jpg"},{"n":78,"bodyKanji":"淡路島 かよふ千鳥の 鳴く声に 幾夜ねざめぬ 須磨の関守","bodyKana":"あはぢしま かよふちどりの なくこゑに いくよねざめぬ すまのせきもり","nameKanji":"源兼昌","nameKana":"みなもとのかねまさ","kimariji":"あはぢ","imageWref":"ファイル:Hyakuninisshu_078.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/b/bf/Hyakuninisshu_078.jpg"},{"n":79,"bodyKanji":"秋風に たなびく雲の たえ間より もれいづる月の 影のさやけさ","bodyKana":"あきかぜに たなびくくもの たえまより もれいづるつきの かげのさやけさ","nameKanji":"左京大夫顕輔","nameKana":"さきょうのだいぶあきすけ","kimariji":"あきか","imageWref":"ファイル:Hyakuninisshu_079.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/1/1d/Hyakuninisshu_079.jpg"},{"n":80,"bodyKanji":"長からむ 心もしらず 黒髪の みだれてけさは 物をこそ思へ","bodyKana":"ながからむ こころもしらず くろかみの みだれてけさは ものをこそおもへ","nameKanji":"待賢門院堀河","nameKana":"たいけんもんいんほりかわ","kimariji":"ながか","imageWref":"ファイル:Hyakuninisshu_080.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/f/f9/Hyakuninisshu_080.jpg"},{"n":81,"bodyKanji":"ほととぎす 鳴きつる方を ながむれば ただありあけの 月ぞ残れる","bodyKana":"ほととぎす なきつるかたを ながむれば ただありあけの つきぞのこれる","nameKanji":"後徳大寺左大臣","nameKana":"ごとくだいじさだいじん","kimariji":"ほ","imageWref":"ファイル:Hyakuninisshu_081.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/d/da/Hyakuninisshu_081.jpg"},{"n":82,"bodyKanji":"思ひわび さてもいのちは あるものを 憂きにたへぬは 涙なりけり","bodyKana":"おもひわび さてもいのちは あるものを うきにたへぬは なみだなりけり","nameKanji":"道因法師","nameKana":"どういんほうし","kimariji":"おも","imageWref":"ファイル:Hyakuninisshu_082.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/f/f2/Hyakuninisshu_082.jpg"},{"n":83,"bodyKanji":"世の中よ 道こそなけれ 思ひ入る 山の奥にも 鹿ぞ鳴くなる","bodyKana":"よのなかよ みちこそなけれ おもひいる やまのおくにも しかぞなくなる","nameKanji":"皇太后宮大夫俊成","nameKana":"こうたいごうぐうのだいぶしゅんぜい","kimariji":"よのなかよ","imageWref":"ファイル:Hyakuninisshu_083.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/b/be/Hyakuninisshu_083.jpg"},{"n":84,"bodyKanji":"ながらへば またこのごろや しのばれむ 憂しと見し世ぞ 今は恋しき","bodyKana":"ながらへば またこのごろや しのばれむ うしとみしよぞ いまはこひしき","nameKanji":"藤原清輔朝臣","nameKana":"ふじわらのきよすけあそん","kimariji":"ながら","imageWref":"ファイル:Hyakuninisshu_084.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/0/05/Hyakuninisshu_084.jpg"},{"n":85,"bodyKanji":"夜もすがら 物思ふころは 明けやらで 閨のひまさへ つれなかりけり","bodyKana":"よもすがら ものおもふころは あけやらで ねやのひまさへ つれなかりけり","nameKanji":"俊恵法師","nameKana":"しゅんえほうし","kimariji":"よも","imageWref":"ファイル:Hyakuninisshu_085.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/0/06/Hyakuninisshu_085.jpg"},{"n":86,"bodyKanji":"なげけとて 月やは物を 思はする かこち顔なる わが涙かな","bodyKana":"なげけとて つきやはものを おもはする かこちがほなる わがなみだかな","nameKanji":"西行法師","nameKana":"さいぎょうほうし","kimariji":"なげけ","imageWref":"ファイル:Hyakuninisshu_086.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/6/61/Hyakuninisshu_086.jpg"},{"n":87,"bodyKanji":"村雨の 露もまだひぬ まきの葉に 霧たちのぼる 秋の夕ぐれ","bodyKana":"むらさめの つゆもまだひぬ まきのはに きりたちのぼる あきのゆふぐれ","nameKanji":"寂蓮法師","nameKana":"じゃくれんほうし","kimariji":"む","imageWref":"ファイル:Hyakuninisshu_087.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/9/9f/Hyakuninisshu_087.jpg"},{"n":88,"bodyKanji":"難波江の 蘆のかりねの ひとよゆゑ みをつくしてや 恋ひわたるべき","bodyKana":"なにはえの あしのかりねの ひとよゆゑ みをつくしてや こひわたるべき","nameKanji":"皇嘉門院別当","nameKana":"こうかもんいんのべつとう","kimariji":"なにはえ","imageWref":"ファイル:Hyakuninisshu_088.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/4/4c/Hyakuninisshu_088.jpg"},{"n":89,"bodyKanji":"玉の緒よ たえなばたえね ながらへば 忍ぶることの 弱りもぞする","bodyKana":"たまのをよ たえなばたえね ながらへば しのぶることの よわりもぞする","nameKanji":"式子内親王","nameKana":"しきしないしんのう","kimariji":"たま","imageWref":"ファイル:Hyakuninisshu_089.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/b/b1/Hyakuninisshu_089.jpg"},{"n":90,"bodyKanji":"見せばやな 雄島のあまの 袖だにも ぬれにぞぬれし 色はかはらず","bodyKana":"みせばやな をじまのあまの そでだにも ぬれにぞぬれし いろはかはらず","nameKanji":"殷富門院大輔","nameKana":"いんぶもんいんのたいふ","kimariji":"みせ","imageWref":"ファイル:Hyakuninisshu_090.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/8/82/Hyakuninisshu_090.jpg"},{"n":91,"bodyKanji":"きりぎりす 鳴くや霜夜の さむしろに 衣かたしき ひとりかも寝む","bodyKana":"きりぎりす なくやしもよの さむしろに ころもかたしき ひとりかもねむ","nameKanji":"後京極摂政前太政大臣","nameKana":"ごきょうごくせっしょうさきのだいじょうだいじん","kimariji":"きり","imageWref":"ファイル:Hyakuninisshu_091.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/c/c3/Hyakuninisshu_091.jpg"},{"n":92,"bodyKanji":"わが袖は 潮干にみえぬ 沖の石の 人こそしらね かわくまもなし","bodyKana":"わがそでは しほひにみえぬ おきのいしの ひとこそしらね かわくまもなし","nameKanji":"二条院讃岐","nameKana":"にじょういんのさぬき","kimariji":"わがそ","imageWref":"ファイル:Hyakuninisshu_092.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/d/d2/Hyakuninisshu_092.jpg"},{"n":93,"bodyKanji":"世の中は つねにもがもな なぎさこぐ あまの小舟の 綱手かなしも","bodyKana":"よのなかは つねにもがもな なぎさこぐ あまのをぶねの つなでかなしも","nameKanji":"鎌倉右大臣","nameKana":"かまくらのうだいじん","kimariji":"よのなかは","imageWref":"ファイル:Hyakuninisshu_093.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/f/f2/Hyakuninisshu_093.jpg"},{"n":94,"bodyKanji":"み吉野の 山の秋風 さ夜ふけて ふるさと寒く 衣うつなり","bodyKana":"みよしのの やまのあきかぜ さよふけて ふるさとさむく ころもうつなり","nameKanji":"参議雅経","nameKana":"さんぎまさつね","kimariji":"みよ","imageWref":"ファイル:Hyakuninisshu_094.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/2/2f/Hyakuninisshu_094.jpg"},{"n":95,"bodyKanji":"おほけなく うき世の民に おほふかな わがたつ杣に 墨染の袖","bodyKana":"おほけなく うきよのたみに おほふかな わがたつそまに すみぞめのそで","nameKanji":"前大僧正慈円","nameKana":"さきのだいそうじょうじえん","kimariji":"おほけ","imageWref":"ファイル:Hyakuninisshu_095.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/a/a6/Hyakuninisshu_095.jpg"},{"n":96,"bodyKanji":"花さそふ 嵐の庭の 雪ならで ふりゆくものは わが身なりけり","bodyKana":"はなさそふ あらしのにはの ゆきならで ふりゆくものは わがみなりけり","nameKanji":"入道前太政大臣","nameKana":"にゅうどうさきのだいじょうだいじん","kimariji":"はなさ","imageWref":"ファイル:Hyakuninisshu_096.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/8/83/Hyakuninisshu_096.jpg"},{"n":97,"bodyKanji":"こぬ人を まつほの浦の 夕なぎに 焼くやもしほの 身もこがれつつ","bodyKana":"こぬひとを まつほのうらの ゆふなぎに やくやもしほの みもこがれつつ","nameKanji":"権中納言定家","nameKana":"ごんちゅうなごんていか","kimariji":"こぬ","imageWref":"ファイル:Hyakuninisshu_097.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/c/cb/Hyakuninisshu_097.jpg"},{"n":98,"bodyKanji":"風そよぐ ならの小川の 夕ぐれは みそぎぞ夏の しるしなりける","bodyKana":"かぜそよぐ ならのをがはの ゆふぐれは みそぎぞなつの しるしなりける","nameKanji":"従二位家隆","nameKana":"じゅうにいいえたか","kimariji":"かぜそ","imageWref":"ファイル:Hyakuninisshu_098.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/0/00/Hyakuninisshu_098.jpg"},{"n":99,"bodyKanji":"人もをし 人もうらめし あぢきなく 世を思ふゆゑに 物思ふ身は","bodyKana":"ひともをし ひともうらめし あぢきなく よをおもふゆゑに ものおもふみは","nameKanji":"後鳥羽院","nameKana":"ごとばいん","kimariji":"ひとも","imageWref":"ファイル:Hyakuninisshu_099.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/8/8c/Hyakuninisshu_099.jpg"},{"n":100,"bodyKanji":"ももしきや ふるき軒ばの しのぶにも なほあまりある 昔なりけり","bodyKana":"ももしきや ふるきのきばの しのぶにも なほあまりある むかしなりけり","nameKanji":"順徳院","nameKana":"じゅんとくいん","kimariji":"もも","imageWref":"ファイル:Hyakuninisshu_100.jpg","imageURL":"http://upload.wikimedia.org/wikipedia/commons/f/ff/Hyakuninisshu_100.jpg"}]