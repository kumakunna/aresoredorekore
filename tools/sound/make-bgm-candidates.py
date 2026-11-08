# tools/sound/make-bgm-candidates.py — 待合の BGM の案を3つ作る（指示75 2-6）
#
#   .cache/earshot-venv/Scripts/python tools/sound/make-bgm-candidates.py      … docs/音の見本帳/BGM_待合_案A〜C.mp3 を書き出す
#
# くまくん（11/7 の検査 A31）：いまの待合の BGM は「雰囲気に合っていない・楽器の数」。いまの曲は音が7つ
#（マリンバ・カリンバ2つ・チェレスタ・タップ・クリック・木の音）。案は**楽器を1〜2つ**にしぼり、リズムの音（タップ・クリック）を入れない。
# 和音とメロディは、いまの曲（make-bgm.py）と同じ（くまくんが聞きくらべる時に、ちがいが「楽器と速さ」だけになるように）。
# 大きさ・ピーク・つなぎ目の作り方も make-bgm.py と同じ（−20 LUFS・mp3 のピーク −3 dBFS 以下・はみ出した響きを頭に重ねる）。
# **アプリには入れない**（えらぶのはくまくん）。えらんだ案を public/sound/bgm/wait.mp3 に写し、index.html の BGM_KINDS.fesWait の loopSec を
# 下の「記録」の loop_s に合わせる（tools/sound/BGMの記録_案.json）。
import sys, os, json, importlib.util
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('make_bgm', os.path.join(HERE, 'make-bgm.py'))
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)   # 部品（note・place・fit）と、和音・メロディを借りる。main は呼ばない
SR = M.SR
OUTDIR = os.path.join(M.ROOT, 'docs', '音の見本帳')


def build(bpm, parts):
    beat = 60.0 / bpm
    bar = 4 * beat
    loop = M.BARS * bar
    tail = 3.5
    buf = np.zeros((int((loop + tail) * SR), 2))
    for b, ch in enumerate(M.CHORDS):
        parts['chord'](buf, b * bar, beat, ch)
    for (b, bt, nm, ln) in M.MELODY:
        parts['melody'](buf, b * bar + bt * beat, max(0.6, ln * beat + 0.8), nm)
    n = int(round(loop * SR))
    over = buf[n:]
    buf = buf[:n].copy()
    buf[:len(over)] += over
    return buf, loop


def 和音_ながい(sound, gain):
    """1小節に1回、和音の3つの音を少しずつずらして鳴らす（ゆっくり・やわらかい）"""
    def f(buf, t0, beat, ch):
        for k, nm in enumerate(M.TONES[ch]):
            place_note(buf, sound, nm + '4', 2.6 * beat, t0 + k * 0.06, gain * (1.0 if k == 0 else 0.8), 0.3 - k * 0.15)
    return f


def 和音_4分(sound, gain):
    """4分の分散和音（根・3・5・3）。いまの曲（8分）の半分のこまかさ"""
    def f(buf, t0, beat, ch):
        t = M.TONES[ch]
        for k, nm in enumerate([t[0], t[1], t[2], t[1]]):
            place_note(buf, sound, nm + '4', 1.1 * beat, t0 + k * beat, gain if k == 0 else gain * 0.8, 0.3)
    return f


def ひくい(sound, gain):
    """小節の頭に根音だけ"""
    def f(buf, t0, beat, ch):
        place_note(buf, sound, M.low(M.ROOT_OF[ch]), 1.6 * beat, t0, gain, -0.15)
    return f


def place_note(buf, sound, pitch, dur, at, gain, pan):
    M.place(buf, M.note(sound, pitch, dur=round(dur, 2)), at, gain, pan)


def メロディ(sound, gain, pan=-0.2):
    def f(buf, at, d, nm):
        place_note(buf, sound, nm, d, at, gain, pan)
    return f


def both(*fs):
    def f(*a):
        for g in fs:
            g(*a)
    return f


CANDIDATES = [
    # 案A：オルゴールのように。チェレスタのメロディと、やわらかいカリンバの長い和音だけ（楽器2つ・リズムの音なし）
    ('A', 'オルゴール（チェレスタ＋やわらかいカリンバ・92 BPM）', 92,
     {'melody': メロディ('mallet/celesta', 0.50), 'chord': 和音_ながい('pluck/kalimba_soft', 0.26)}),
    # 案B：マリンバだけ。メロディと、小節の頭の低い音（楽器1つ・木のあたたかい音）
    ('B', 'マリンバだけ（メロディと低い音・100 BPM）', 100,
     {'melody': メロディ('mallet/marimba', 0.52), 'chord': ひくい('mallet/marimba', 0.40)}),
    # 案C：カリンバだけ。4分の分散和音と、メロディ（楽器1つ・いちばん静か）
    ('C', 'カリンバだけ（4分の和音とメロディ・88 BPM）', 88,
     {'melody': メロディ('pluck/kalimba', 0.46, -0.1), 'chord': 和音_4分('pluck/kalimba_soft', 0.22)}),
]


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    rec = {}
    for key, label, bpm, parts in CANDIDATES:
        y, loop = build(bpm, parts)
        y, b, lufs, pk = M.fit(y)
        out = os.path.join(OUTDIR, 'BGM_待合_案' + key + '.mp3')
        open(out, 'wb').write(b)
        rec[key] = {'label': label, 'bpm': bpm, 'bars': M.BARS, 'loop_s': round(loop, 4), 'lufs_integrated': round(lufs, 2), 'peak_db_mp3': round(pk, 2), 'kb': len(b) // 1024}
        print(f'✔ 案{key} {label}：{loop:.2f}秒・{lufs:.1f} LUFS・ピーク {pk:.2f} dB・{len(b) // 1024}KB → {os.path.relpath(out, M.ROOT)}')
    json.dump(rec, open(os.path.join(HERE, 'BGMの記録_案.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
