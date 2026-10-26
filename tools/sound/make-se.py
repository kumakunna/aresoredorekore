# tools/sound/make-se.py — 効果音を earshot の部品から作る（指示68-2 第6節）
#
#   .cache/earshot-venv/Scripts/python tools/sound/make-se.py           … 作って public/sound/se/ と見本帳に書き出す
#   .cache/earshot-venv/Scripts/python tools/sound/make-se.py --check   … 作り直して、今のファイルと同じ音になるかだけ見る
#
# 下ごしらえと、earshot を使う条件（くまくんの決め 2026-10-26）は tools/sound/README.md。
# 条件①：earshot はコミット 591fa3e に固定（違えばここで止まる）②音の部品 forge の bank だけ・モデルは入れない ③動かすのは tools/sound/ の台本だけ
#
# **音は下の表 SE から作る。手でファイルを直さない**（作り直すと同じ音になる：部品の seed を表に書いてある）。
# 1つの ID に 2〜3本（鳴らすたびに変える）。1本は「部品の重ね」：(部品, 高さ, 始まりの秒, 重さ, seed) の並び。
#
# 大きさ：どの音も「瞬間の大きさの最大（LUFS momentary max）」を TARGET ±2LU にそろえ、最大は -1dBFS 以下。
#   静かすぎて目標に届かない部品は使わない（ここで止まる）。爆発（boom）だけは帯のいちばん上（TARGET+2）に置く
#   ＝大きな音は爆発の1回だけ（安全の決まり）。高すぎる音（hover_tick/high など）・長く続く音は使わない
#
# 出すもの：
#   public/sound/se/<ID>-<n>.mp3       アプリが読む
#   public/sound/index.json            { se: { ID: 本数 }, voice: { ... } }（voice は tools/sound/import-voice.py が書く本数を残す）
#   tools/sound/記録.json               1本ごとの大きさ・最大・長さ・使った部品
#   docs/音の見本帳/見本帳.mp3・一覧.md   くまくんが順番に聞くためのもの
import sys, os, json, hashlib, io

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
from earshot.forge import bank
from earshot.forge.polish import lufs_max

SR = 48000
TARGET = -25.0      # LUFS momentary max（短いクリックは最大 -1dB でも -24〜-27 までしか届かないので、そこに合わせて大きい音を下げる）
BAND = 2.0          # ±LU
PEAK = -1.0         # dBFS 以下

def P(sound, pitch=None, at=0.0, w=1.0, seed=None, dur=None):
    return {'sound': sound, 'pitch': pitch, 'at': at, 'w': w, 'seed': seed, 'dur': dur}

# ---- 音の ID → 作り方（指示68-2 第6節の表から選んだ。聞いて合わなければここを直して作り直す） ----
SE = {
    # 3・2・1／残り秒：軽い「カチ」
    'tick':    [[P('hover_tick/detent')], [P('hover_tick/mid')], [P('click/tink')]],
    # カウントダウン（3・2・1 と大画面の残り5秒）：やわらかいカリンバの1音
    'count':   [[P('pluck/kalimba_soft', 'G4', dur=0.6, seed=11)], [P('pluck/kalimba_soft', 'G4', dur=0.6, seed=12)]],
    # 正解・できた：カリンバを2音で上げる
    'ok':      [[P('pluck/kalimba', 'E5', dur=0.6), P('pluck/kalimba', 'A5', 0.12, dur=0.7)],
                [P('pluck/kalimba', 'C5', dur=0.6), P('pluck/kalimba', 'G5', 0.12, dur=0.7)],
                [P('pluck/kalimba', 'D5', dur=0.6), P('pluck/kalimba', 'A5', 0.12, dur=0.7)]],
    # 決まった（長押しで決める・始まる）：響くカリンバの和音
    'decide':  [[P('pluck/kalimba_ring', 'C5', dur=1.0), P('pluck/kalimba_ring', 'G5', 0.06, 0.7, dur=1.0)],
                [P('pluck/kalimba_ring', 'D5', dur=1.0), P('pluck/kalimba_ring', 'A5', 0.06, 0.7, dur=1.0)]],
    # 押した時のコツ（スマホで鳴る唯一の音）
    'tap':     [[P('click/soft')], [P('tap/soft')], [P('tap/finger')]],
    # まちがい・禁止ワード：低く短く（こわくしない）
    'ng':      [[P('knock/plastic')], [P('knock/double')]],
    # 外した・失敗：ng と分ける（木の音）
    'miss':    [[P('knock/desk')], [P('knock/desk', seed=7)]],
    # クイズ王の正解・称号：響くカリンバを4音で上げる
    'fanfare': [[P('pluck/kalimba_ring', 'C5', 0.00, 0.9, dur=0.9), P('pluck/kalimba_ring', 'E5', 0.09, 0.9, dur=0.9),
                 P('pluck/kalimba_ring', 'G5', 0.18, 0.9, dur=0.9), P('pluck/kalimba_ring', 'C6', 0.27, 1.0, dur=1.1)],
                [P('logo_sting/soft_bloom', dur=1.4)]],
    # 盛り上がる場面：きらきら＋明るい和音（人の声の部品は無いので、音の重ねで代える）
    'cheer':   [[P('shimmer/m2', w=0.8, dur=1.2), P('pluck/kalimba', 'C5', 0.0, 0.6, dur=1.0), P('pluck/kalimba', 'E5', 0.0, 0.6, dur=1.0),
                 P('pluck/kalimba', 'G5', 0.0, 0.6, dur=1.0)],
                [P('pro_shimmer/m1', w=0.8, dur=1.2), P('pop/2', at=0.0, w=0.8)]],
    # 時間切れ：カリンバを2音で下げる（失敗ではないのでやわらかく）
    'timeup':  [[P('pluck/kalimba', 'A4', dur=0.7), P('pluck/kalimba', 'E4', 0.16, dur=0.9)],
                [P('pluck/kalimba', 'G4', dur=0.7), P('pluck/kalimba', 'D4', 0.16, dur=0.9)]],
    # オークションの木槌
    'gavel':   [[P('knock/wood')], [P('knock/wood', seed=5)]],
    # 落札：木槌＋ポン
    'sold':    [[P('knock/wood'), P('pop/2', at=0.12, w=0.8)], [P('knock/wood', seed=5), P('pop/3', at=0.12, w=0.8)]],
    # クイズ解除：コードを切る
    'cut':     [[P('cut_hit/air', dur=0.4)], [P('cut_hit/punch', dur=0.4)], [P('pro_tap/knock'), P('pop/1', at=0.03, w=0.7)]],
    # クイズ解除：火花（TV でコードが切れる）
    'spark':   [[P('pro_pop_in/airy')], [P('shimmer/m0', dur=0.5)]],
    # クイズ解除：解除成功
    'defuse':  [[P('logo_sting/spark', dur=1.6)], [P('logo_sting/soft_bloom', dur=1.6, seed=3)]],
    # クイズ解除：爆発（大きな音はこの1回だけ）
    'boom':    [[P('impact/blast', dur=2.5)]],
}
LOUD = {'boom': TARGET + BAND}   # ID ごとの目標（無ければ TARGET）

def mono(y):
    y = np.asarray(y, np.float64)
    return y.mean(axis=1) if y.ndim == 2 else y

def render_part(p):
    kw = {'checks': False}
    if p['pitch']: kw['pitch'] = p['pitch']
    if p['seed'] is not None: kw['seed'] = p['seed']
    if p['dur'] is not None: kw['dur'] = p['dur']
    y, meta = bank.render(p['sound'], **kw)
    return mono(y) * p['w']

def build(recipe):
    parts = [(int(round(p['at'] * SR)), render_part(p)) for p in recipe]
    n = max(off + len(y) for off, y in parts)
    out = np.zeros(n)
    for off, y in parts:
        out[off:off + len(y)] += y
    # 末尾の無音を切る（-60dB 未満）・はじめと終わりを 5ms でならす
    th = 10 ** (-60 / 20) * np.abs(out).max()
    live = np.nonzero(np.abs(out) > th)[0]
    out = out[:live[-1] + 1] if len(live) else out
    f = min(len(out) // 4, int(0.005 * SR))
    if f > 0:
        out[-f:] *= np.linspace(1, 0, f)
    return out

def fit_level(y, target):
    """瞬間の大きさの最大を target に。最大が PEAK を超えるなら PEAK で止める（その時は届かない＝表を直す）"""
    y = y / (np.abs(y).max() + 1e-12) * 10 ** (PEAK / 20)
    l = lufs_max(y)
    g = 10 ** ((target - l) / 20)
    if g > 1:
        g = 1.0
    y = y * g
    return y, float(lufs_max(y)), float(20 * np.log10(np.abs(y).max() + 1e-12))

def mp3_bytes(y):
    buf = io.BytesIO()
    sf.write(buf, y.astype(np.float32), SR, format='MP3')
    return buf.getvalue()

def make_all():
    files, rec, bad = {}, {}, []
    for sid, takes in SE.items():
        target = LOUD.get(sid, TARGET)
        for i, recipe in enumerate(takes, 1):
            y, l, pk = fit_level(build(recipe), target)
            name = f'{sid}-{i}'
            ok = abs(l - target) <= (0.5 if sid in LOUD else BAND) or (abs(l - TARGET) <= BAND)
            if pk > PEAK + 0.01 or abs(l - TARGET) > BAND + (BAND if sid in LOUD else 0):
                bad.append(f'{name}: 大きさ {l:.1f} LUFS（目標 {target:.0f}±{BAND:.0f}）・最大 {pk:.1f} dB')
            files[name] = (y, mp3_bytes(y))
            rec[name] = {'lufs_m_max': round(l, 2), 'peak_db': round(pk, 2), 'dur_s': round(len(y) / SR, 3),
                         'parts': [{k: v for k, v in p.items() if v is not None} for p in recipe]}
    return files, rec, bad

def main():
    check = '--check' in sys.argv
    files, rec, bad = make_all()
    if bad:
        print('✖ 大きさがそろわない（表の部品を変える）：\n  ' + '\n  '.join(bad))
        sys.exit(1)
    se_dir = os.path.join(ROOT, 'public', 'sound', 'se')
    if check:
        diff = []
        for name, (y, b) in files.items():
            p = os.path.join(se_dir, name + '.mp3')
            if not os.path.exists(p) or hashlib.sha256(open(p, 'rb').read()).hexdigest() != hashlib.sha256(b).hexdigest():
                diff.append(name)
        print(('✖ 作り直すと違う音になる：' + '・'.join(diff)) if diff else f'✔ 作り直しても同じ音（{len(files)}本）')
        sys.exit(1 if diff else 0)
    os.makedirs(se_dir, exist_ok=True)
    for f in os.listdir(se_dir):
        if f.endswith('.mp3'): os.remove(os.path.join(se_dir, f))
    for name, (y, b) in files.items():
        open(os.path.join(se_dir, name + '.mp3'), 'wb').write(b)
    # index.json：効果音の本数（声の本数は残す）
    ip = os.path.join(ROOT, 'public', 'sound', 'index.json')
    idx = json.load(open(ip, encoding='utf-8')) if os.path.exists(ip) else {}
    idx['se'] = {sid: len(takes) for sid, takes in SE.items()}
    idx.setdefault('voice', {})
    json.dump(idx, open(ip, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    louds = [r['lufs_m_max'] for r in rec.values()]
    json.dump({'target_lufs_m_max': TARGET, 'band_lu': BAND, 'peak_max_db': PEAK,
               'range_lufs': [min(louds), max(louds)], 'files': rec},
              open(os.path.join(ROOT, 'tools', 'sound', '記録.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    # 見本帳：全部を順番に（0.7秒あけて）1つの mp3 に
    book_dir = os.path.join(ROOT, 'docs', '音の見本帳')
    os.makedirs(book_dir, exist_ok=True)
    gap = np.zeros(int(0.7 * SR))
    seq, lines, t = [], ['# 音の見本帳（指示68-2）', '', '`見本帳.mp3` を頭から聞くと、この順に鳴る。作り直しは `tools/sound/make-se.py`。', '',
                         '| 秒 | 音 | 使う所 | 大きさ（LUFS） |', '|---|---|---|---|'], 0.0
    USE = {'tick': '3・2・1／残り秒', 'count': 'カウントダウン', 'ok': '正解・できた', 'decide': '決まった・始まる', 'tap': '押した時のコツ（スマホ）',
           'ng': 'まちがい・禁止ワード', 'miss': '外した・失敗', 'fanfare': 'クイズ王の正解・称号', 'cheer': '盛り上がる場面', 'timeup': '時間切れ',
           'gavel': 'オークションの木槌', 'sold': '落札', 'cut': 'クイズ解除：コードを切る', 'spark': 'クイズ解除：火花', 'defuse': 'クイズ解除：解除成功',
           'boom': 'クイズ解除：爆発'}
    for name, (y, b) in files.items():
        sid = name.rsplit('-', 1)[0]
        lines.append(f'| {t:.1f} | {name} | {USE.get(sid, "")} | {rec[name]["lufs_m_max"]} |')
        seq += [y, gap]
        t += (len(y) + len(gap)) / SR
    open(os.path.join(book_dir, '見本帳.mp3'), 'wb').write(mp3_bytes(np.concatenate(seq)))
    open(os.path.join(book_dir, '一覧.md'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    total = sum(len(b) for _, b in files.values())
    print(f'✔ {len(files)}本を書き出した（{total // 1024}KB）・大きさ {min(louds):.1f}〜{max(louds):.1f} LUFS・見本帳 {t:.0f}秒')

if __name__ == '__main__':
    main()
