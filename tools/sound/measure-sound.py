# tools/sound/measure-sound.py — 鳴る音のファイルを全部測る（11/7 の検査の準備 8）
#
#   .cache/earshot-venv/Scripts/python tools/sound/measure-sound.py      … public/sound/ の se・bgm・voice を測って
#                                                                           docs/検査_1107/8_音の測り.json を書く
#
# earshot は使わない（読むのは numpy・scipy・soundfile・pyloudnorm だけ。README の「earshot を使う条件」の外）。
# 測る数（docs/検査_1107/追加_調べた結果から.md の 8）：
#   ・ラウドネス：曲全体（integrated・0.4秒より短い音は前後に無音を足して測る＝目安）と、瞬間の最大（momentary 400ms の最大）
#   ・トゥルーピーク（dBTP）：4倍に細かくして測るピーク
#   ・高い音：2〜5kHz と 4kHz より上の強さ（全体の強さに対する dB）
#   ・立ち上がり：音が鳴りはじめてから最大の 90% に届くまでの ms と、5ms でどれだけ大きくなるか（dB）
# 「耳に刺さりそう」の印（仮の線・明日人の耳で決め直す）：
#   トゥルーピーク −1 dBTP をこえる／4kHz より上が −10 dB より強い（全体の1割より上）／立ち上がり 5ms より急で、しかも瞬間の最大が −26 LUFS より大きい
import json
import os
import sys

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy.signal import resample_poly, butter, sosfilt

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'public', 'sound')
OUT = os.path.join(ROOT, 'docs', '検査_1107', '8_音の測り.json')


def db(x):
    return float(20 * np.log10(max(x, 1e-12)))


def band_db(mono, sr, lo, hi):
    """lo〜hi Hz の強さ（全体に対する dB）。hi=None は lo より上"""
    if hi is None:
        sos = butter(6, lo, btype='highpass', fs=sr, output='sos')
    else:
        sos = butter(6, [lo, min(hi, sr / 2 - 1)], btype='bandpass', fs=sr, output='sos')
    y = sosfilt(sos, mono)
    e_all = float(np.sum(mono ** 2)) + 1e-20
    return float(10 * np.log10((float(np.sum(y ** 2)) + 1e-20) / e_all))


def measure(path):
    data, sr = sf.read(path, always_2d=True)
    data = data.astype(np.float64)
    mono = data.mean(axis=1)
    dur = len(mono) / sr
    meter = pyln.Meter(sr)
    pad = np.zeros((int(sr * 0.5), data.shape[1]))
    padded = np.vstack([pad, data, pad]) if dur < 0.4 else data
    try:
        integ = float(meter.integrated_loudness(padded))
    except Exception:
        integ = None
    # 瞬間の最大（400ms の窓を 100ms ずつ）
    win, hop = int(sr * 0.4), int(sr * 0.1)
    src = np.vstack([data, np.zeros((max(0, win - len(data)), data.shape[1]))])
    mom = -120.0
    kw = pyln.Meter(sr, block_size=0.4)   # 400ms の窓1つ＝瞬間の大きさ（momentary）
    for s in range(0, max(1, len(src) - win + 1), hop):
        seg = src[s:s + win]
        try:
            v = float(kw.integrated_loudness(seg))
        except Exception:
            v = None
        if v is not None and np.isfinite(v):
            mom = max(mom, v)
    tp = db(float(np.max(np.abs(resample_poly(data, 4, 1, axis=0))))) if len(data) else -120.0
    sp = db(float(np.max(np.abs(data))))
    # 立ち上がり：1ms ごとの包絡
    env_step = max(1, int(sr * 0.001))
    env = np.array([np.max(np.abs(mono[i:i + env_step])) for i in range(0, len(mono), env_step)])
    pk = float(env.max()) if len(env) else 0.0
    start = int(np.argmax(env > pk * 0.05)) if pk > 0 else 0
    reach = int(np.argmax(env > pk * 0.9)) if pk > 0 else 0
    rise_ms = max(0, reach - start)
    # 5ms でどれだけ大きくなるか（いちばん急な所）
    e_db = 20 * np.log10(np.maximum(env, 1e-6))
    jump5 = float(np.max(e_db[5:] - e_db[:-5])) if len(e_db) > 5 else 0.0
    hi4 = band_db(mono, sr, 4000, None)
    b25 = band_db(mono, sr, 2000, 5000)
    marks = []
    if tp > -1.0:
        marks.append('ピーク −1dBTP 超')
    if hi4 > -10:
        marks.append('4kHz より上が強い')
    if rise_ms < 5 and mom > -26:
        marks.append('急に鳴る（5ms 未満）')
    return {
        'dur_s': round(dur, 3), 'sr': sr, 'ch': data.shape[1],
        'lufs_i': None if integ is None or not np.isfinite(integ) else round(integ, 1),
        'lufs_m_max': round(mom, 1), 'true_peak_dbtp': round(tp, 2), 'sample_peak_db': round(sp, 2),
        'band_2_5k_db': round(b25, 1), 'above_4k_db': round(hi4, 1), 'rise_ms': rise_ms, 'jump_5ms_db': round(jump5, 1),
        'marks': marks,
    }


def main():
    rows = {}
    for kind in ('se', 'bgm', 'voice'):
        d = os.path.join(SRC, kind)
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if f.lower().endswith(('.mp3', '.wav', '.ogg')):
                rows[kind + '/' + f] = measure(os.path.join(d, f))
                r = rows[kind + '/' + f]
                print(f'{kind}/{f}: {r["dur_s"]}s  M最大 {r["lufs_m_max"]}  I {r["lufs_i"]}  TP {r["true_peak_dbtp"]}  4k↑ {r["above_4k_db"]}  立ち上がり {r["rise_ms"]}ms  {"・".join(r["marks"])}')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as fp:
        json.dump(rows, fp, ensure_ascii=False, indent=1)
    print('→', os.path.relpath(OUT, ROOT), len(rows), '本')


if __name__ == '__main__':
    sys.exit(main())
