# tools/sound/make-bgm.py — 待合の BGM を earshot の部品から作る（指示68-T・三の束の BGM の候補）
#
#   .cache/earshot-venv/Scripts/python tools/sound/make-bgm.py           … 作って docs/音の見本帳/BGM_待合.mp3 に書き出す
#   .cache/earshot-venv/Scripts/python tools/sound/make-bgm.py --check   … 作り直して、今のファイルと同じ音になるかだけ見る
#
# 指示68-T 三の束2（10/31）でアプリに入れた：public/sound/bgm/wait.mp3 に写して、文化祭の TV の待合だけで鳴らす（係の画面の入／切・はじめは切）。
# 作り直したら、docs/音の見本帳/BGM_待合.mp3 を public/sound/bgm/wait.mp3 に写す（index.html の BGM_KINDS.fesWait）。
# earshot を使う条件は tools/sound/README.md（591fa3e に固定・音の部品 bank だけ・動かすのは tools/sound/ の台本だけ）。
#
# 曲：ハ長調・112 BPM・4/4・16小節（約34秒）でくり返す。A（8小節）→ B（8小節）→ A にもどる。
#   低い音　 … マリンバ（mallet/marimba）：小節の頭に根音、3拍目に5度
#   和音　　 … やわらかいカリンバ（pluck/kalimba_soft）：8分の分散和音
#   メロディ … チェレスタ（mallet/celesta）＋うすくカリンバ（pluck/kalimba）を重ねる
#   リズム　 … 指のタップ（pro_tap/soft）を2・4拍に、うすいクリック（click/soft）を裏拍に
# **つなぎ目が切れない**：曲の終わりからはみ出した響きは、頭に重ねてからファイルにする（何度くり返しても、つなぎ目でぷつっと切れない）。
#   ただし mp3 は頭と終わりにわずかな無音（エンコーダーのすき間・数十ミリ秒）が入るので、アプリで回す時は loopStart／loopEnd を使う
# 大きさ：曲全体の大きさ（integrated LUFS）を TARGET に。ピークは mp3 を読みもどして -3dBFS 以下（効果音と同じ決まり）。
#   アプリで鳴らす時は、これよりずっと小さくする（BGM の音量 × 小さい係数・調べもの12節）
import sys, os, io, json, hashlib

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.stdout.reconfigure(encoding='utf-8')
EARSHOT = os.path.join(ROOT, '.cache', 'earshot')
PIN = '591fa3e'
import subprocess
_head = subprocess.run(['git', '-C', EARSHOT, 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
if not _head.startswith(PIN):
    print(f'✖ earshot は {PIN} に固定する決まり（いま {_head or "無い"}）。tools/sound/README.md の手順で入れ直す')
    sys.exit(2)
sys.path.insert(0, EARSHOT)
import numpy as np
import soundfile as sf
import pyloudnorm as pyln
from earshot.forge import bank

SR = 48000
BPM = 112
BEAT = 60.0 / BPM
BAR = 4 * BEAT
BARS = 16
LOOP = BARS * BAR
TARGET = -20.0     # integrated LUFS
PEAK = -3.0        # dBFS（mp3 を読みもどした値）
OUT = os.path.join(ROOT, 'docs', '音の見本帳', 'BGM_待合.mp3')

# ---- 和音（小節ごと）。A：C Am F G C Am Dm G ／ B：F G Em Am Dm G C G ----
CHORDS = ['C', 'Am', 'F', 'G', 'C', 'Am', 'Dm', 'G', 'F', 'G', 'Em', 'Am', 'Dm', 'G', 'C', 'G']
TONES = {'C': ['C', 'E', 'G'], 'Am': ['A', 'C', 'E'], 'F': ['F', 'A', 'C'], 'G': ['G', 'B', 'D'], 'Dm': ['D', 'F', 'A'], 'Em': ['E', 'G', 'B']}
ROOT_OF = {'C': 'C', 'Am': 'A', 'F': 'F', 'G': 'G', 'Dm': 'D', 'Em': 'E'}
FIFTH_OF = {'C': 'G', 'Am': 'E', 'F': 'C', 'G': 'D', 'Dm': 'A', 'Em': 'B'}

# ---- メロディ：(小節, 拍, 音, 長さ[拍]) ----
MELODY = [
    (0, 0, 'E5', 1), (0, 1, 'G5', 1), (0, 2, 'A5', .5), (0, 2.5, 'G5', .5), (0, 3, 'E5', 1),
    (1, 0, 'C5', 1), (1, 1, 'E5', 1), (1, 2, 'D5', 1), (1, 3, 'C5', 1),
    (2, 0, 'A5', 1.5), (2, 1.5, 'G5', .5), (2, 2, 'F5', 1), (2, 3, 'A5', 1),
    (3, 0, 'G5', 2), (3, 2, 'D5', 1), (3, 3, 'E5', .5), (3, 3.5, 'F5', .5),
    (4, 0, 'E5', 1), (4, 1, 'G5', 1), (4, 2, 'C6', 1), (4, 3, 'A5', .5), (4, 3.5, 'G5', .5),
    (5, 0, 'A5', 1), (5, 1, 'G5', .5), (5, 1.5, 'E5', .5), (5, 2, 'C5', 2),
    (6, 0, 'D5', 1), (6, 1, 'F5', 1), (6, 2, 'A5', 1), (6, 3, 'G5', 1),
    (7, 0, 'G5', 3),
    (8, 0, 'C6', 1), (8, 1, 'A5', 1), (8, 2, 'F5', 1), (8, 3, 'A5', 1),
    (9, 0, 'B5', 1), (9, 1, 'G5', 1), (9, 2, 'D5', 1), (9, 3, 'G5', 1),
    (10, 0, 'G5', 1), (10, 1, 'E5', .5), (10, 1.5, 'G5', .5), (10, 2, 'B5', 2),
    (11, 0, 'A5', 1), (11, 1, 'C6', 1), (11, 2, 'E6', 1), (11, 3, 'C6', 1),
    (12, 0, 'D6', 1.5), (12, 1.5, 'C6', .5), (12, 2, 'A5', 1), (12, 3, 'F5', 1),
    (13, 0, 'G5', 1), (13, 1, 'B5', 1), (13, 2, 'D6', 2),
    (14, 0, 'C6', 1), (14, 1, 'G5', 1), (14, 2, 'E5', 1), (14, 3, 'G5', 1),
    (15, 0, 'D5', 1), (15, 1, 'E5', .5), (15, 1.5, 'F5', .5), (15, 2, 'G5', 2),
]

_cache = {}
def note(sound, pitch=None, dur=None, seed=None):
    key = (sound, pitch, dur, seed)
    if key not in _cache:
        kw = {'checks': False}
        if pitch: kw['pitch'] = pitch
        if dur: kw['dur'] = dur
        if seed is not None: kw['seed'] = seed
        y, _ = bank.render(sound, **kw)
        y = np.asarray(y, np.float64)
        _cache[key] = y.mean(axis=1) if y.ndim == 2 else y
    return _cache[key]

def low(nm):
    """低い音の高さ。マリンバの部品は D3 より下を出せないので、E3〜D4 の中に置く（C・D だけ 4）"""
    return nm + ('4' if nm in ('C', 'D') else '3')

def place(buf, y, at, gain, pan):
    """at 秒に、gain の大きさで、pan（-1 左〜+1 右）に置く。等パワーの定位"""
    i = int(round(at * SR))
    th = (pan + 1) * np.pi / 4
    l, r = np.cos(th) * gain, np.sin(th) * gain
    n = min(len(y), buf.shape[0] - i)
    buf[i:i + n, 0] += y[:n] * l
    buf[i:i + n, 1] += y[:n] * r

def build():
    tail = 3.0
    buf = np.zeros((int((LOOP + tail) * SR), 2))
    for b, ch in enumerate(CHORDS):
        t0 = b * BAR
        # 低い音：根音（1拍目）と5度（3拍目）
        place(buf, note('mallet/marimba', low(ROOT_OF[ch]), dur=1.4), t0, 0.55, -0.1)
        place(buf, note('mallet/marimba', low(FIFTH_OF[ch]), dur=1.2), t0 + 2 * BEAT, 0.42, -0.1)
        # 和音：8分の分散和音（根・3・5・3 をくり返す）。強拍を少しだけ大きく
        tones = TONES[ch]
        pat = [tones[0], tones[1], tones[2], tones[1], tones[0], tones[1], tones[2], tones[1]]
        for k, nm in enumerate(pat):
            oct_ = '5' if (nm in ('C', 'D') and ch not in ('C',)) else '4'
            place(buf, note('pluck/kalimba_soft', nm + oct_, dur=0.9), t0 + k * BEAT / 2, 0.20 if k % 2 else 0.26, 0.35)
        # リズム：2・4拍にタップ、裏拍にうすいクリック。4小節ごとの頭に木の音
        for k in (1, 3):
            place(buf, note('pro_tap/soft', seed=11 + k), t0 + k * BEAT, 0.30, 0.0)
        for k in range(4):
            place(buf, note('click/soft', seed=21), t0 + (k + 0.5) * BEAT, 0.07, 0.25)
        if b % 4 == 0:
            place(buf, note('knock/wood', 'C4', dur=0.6), t0, 0.18, -0.3)
    # メロディ：チェレスタ＋うすくカリンバ
    for (b, beat, nm, ln) in MELODY:
        at = b * BAR + beat * BEAT
        d = max(0.5, ln * BEAT + 0.6)
        place(buf, note('mallet/celesta', nm, dur=d), at, 0.50, -0.25)
        place(buf, note('pluck/kalimba', nm, dur=d), at, 0.16, 0.2)
    # つなぎ目：曲の終わりからはみ出した響きを、頭に重ねる
    n = int(round(LOOP * SR))
    over = buf[n:]
    buf = buf[:n].copy()
    buf[:len(over)] += over
    return buf

def mp3_bytes(y):
    b = io.BytesIO()
    sf.write(b, y.astype(np.float32), SR, format='MP3')
    return b.getvalue()

def fit(y):
    meter = pyln.Meter(SR)
    l = meter.integrated_loudness(y)
    y = y * 10 ** ((TARGET - l) / 20)
    for _ in range(6):
        b = mp3_bytes(y)
        z, _ = sf.read(io.BytesIO(b), dtype='float64')
        pk = 20 * np.log10(np.abs(z).max() + 1e-12)
        if pk <= PEAK: break
        y = y * 10 ** ((PEAK - 0.2 - pk) / 20)   # ピークが上がりすぎたら、全体を下げる
    return y, b, float(meter.integrated_loudness(y)), float(pk)

def main():
    y, b, lufs, pk = fit(build())
    if '--check' in sys.argv:
        same = os.path.exists(OUT) and hashlib.sha256(open(OUT, 'rb').read()).hexdigest() == hashlib.sha256(b).hexdigest()
        print('✔ 作り直しても同じ音' if same else '✖ 作り直すと違う音になる')
        sys.exit(0 if same else 1)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'wb').write(b)
    rec = {'bpm': BPM, 'bars': BARS, 'loop_s': round(LOOP, 4), 'lufs_integrated': round(lufs, 2), 'peak_db_mp3': round(pk, 2),
           'kb': len(b) // 1024, 'chords': CHORDS}
    json.dump(rec, open(os.path.join(ROOT, 'tools', 'sound', 'BGMの記録.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'✔ {os.path.relpath(OUT, ROOT)}：{LOOP:.2f}秒（{BARS}小節・{BPM} BPM）・大きさ {lufs:.1f} LUFS・ピーク {pk:.2f} dB（mp3）・{len(b) // 1024}KB')

if __name__ == '__main__':
    main()
