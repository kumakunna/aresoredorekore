# tools/sound/import-voice.py — くまくんの録音から司会の声を作る（指示68-2 第3節）
#
#   .cache/earshot-venv/Scripts/python tools/sound/import-voice.py            … docs/声の素材/MP3/ から作る
#   .cache/earshot-venv/Scripts/python tools/sound/import-voice.py --src DIR  … ほかの置き場から
#   --out DIR … 試しに別の置き場へ書く（public/sound/index.json と記録は書かない）
#
# 録音のファイル名は言葉の ID（v01.mp3・v07a.mp3 …。public/js/sound.js の VOICES）。ID でない名前は読まない。
# 1本ごとに：
#   ① 前後の無音を切る（いちばん大きい所より 45dB 小さい所を無音とみなす。前は 30ms、後ろは 80ms 残す）
#   ② 0.35秒以上の無音で区切って、何回か録ってあれば分ける（0.15秒より短いかたまりは、息や物音として捨てる）
#   ③ 大きさをそろえる：瞬間の大きさの最大（400ms）を -20 LUFS、最大 -1dBFS 以下（効果音の -25 より少し大きく）
#   ④ mono・48kHz の mp3 で public/sound/voice/<ID>-<n>.mp3 に書く
# earshot は使わない（numpy・soundfile・pyloudnorm だけ）。録音そのもの（docs/声の素材/）は git に入れない
import sys, os, json, re, io
sys.stdout.reconfigure(encoding='utf-8')
import numpy as np
import soundfile as sf
import pyloudnorm as pyln

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SR = 48000
TARGET = -20.0
PEAK = -1.0
SILENCE_DB = -45.0
GAP_S = 0.35
MIN_S = 0.15
VOICE_ID = re.compile(r'^v\d\d[a-c]?$')

def lufs_m_max(y, sr):
    meter = pyln.Meter(sr, block_size=0.400)
    win, hop = int(0.4 * sr), int(0.1 * sr)
    if len(y) < win:
        y = np.concatenate([y, np.zeros(win - len(y))])
    best = -70.0
    for s in range(0, len(y) - win + 1, hop):
        seg = y[s:s + win]
        if np.abs(seg).max() < 1e-6:
            continue
        with np.errstate(divide='ignore'):
            v = meter.integrated_loudness(seg)
        if np.isfinite(v):
            best = max(best, v)
    return best

def resample(y, sr):
    if sr == SR:
        return y
    import soxr
    return soxr.resample(y, sr, SR)

def split_takes(y):
    """無音で区切ったかたまり（開始, 終わり）の並び"""
    env_win = int(0.01 * SR)
    a = np.abs(y)
    env = np.convolve(a, np.ones(env_win) / env_win, mode='same')
    th = a.max() * 10 ** (SILENCE_DB / 20)
    loud = env > th
    takes, i, n = [], 0, len(y)
    while i < n:
        if not loud[i]:
            i += 1; continue
        s = i
        quiet = 0
        while i < n and (loud[i] or quiet < GAP_S * SR):
            quiet = 0 if loud[i] else quiet + 1
            i += 1
        e = i - quiet
        if (e - s) / SR >= MIN_S:
            takes.append((max(0, s - int(0.03 * SR)), min(n, e + int(0.08 * SR))))
    return takes

def fit(y):
    y = y / (np.abs(y).max() + 1e-12) * 10 ** (PEAK / 20)
    l = lufs_m_max(y, SR)
    g = min(1.0, 10 ** ((TARGET - l) / 20))
    y = y * g
    f = int(0.008 * SR)
    if len(y) > 2 * f:
        y[:f] *= np.linspace(0, 1, f); y[-f:] *= np.linspace(1, 0, f)
    return y, lufs_m_max(y, SR), 20 * np.log10(np.abs(y).max() + 1e-12)

def main():
    src = sys.argv[sys.argv.index('--src') + 1] if '--src' in sys.argv else os.path.join(ROOT, 'docs', '声の素材', 'MP3')
    trial = '--out' in sys.argv
    out_dir = sys.argv[sys.argv.index('--out') + 1] if trial else os.path.join(ROOT, 'public', 'sound', 'voice')
    os.makedirs(out_dir, exist_ok=True)
    rec, counts = {}, {}
    names = sorted(f for f in os.listdir(src) if os.path.splitext(f)[1].lower() in ('.mp3', '.wav', '.flac') and VOICE_ID.match(os.path.splitext(f)[0]))
    if not names:
        print('✖ 録音が見つからない：' + src); sys.exit(1)
    for f in os.listdir(out_dir):
        if f.endswith('.mp3'): os.remove(os.path.join(out_dir, f))
    for f in names:
        vid = os.path.splitext(f)[0]
        y, sr = sf.read(os.path.join(src, f), always_2d=True)
        y = resample(y.mean(axis=1), sr)
        takes = split_takes(y)
        rec[vid] = {'src': f, 'src_s': round(len(y) / SR, 2), 'takes': []}
        for n, (s, e) in enumerate(takes, 1):
            z, l, pk = fit(y[s:e].copy())
            buf = io.BytesIO()
            sf.write(buf, z.astype(np.float32), SR, format='MP3')
            open(os.path.join(out_dir, f'{vid}-{n}.mp3'), 'wb').write(buf.getvalue())
            rec[vid]['takes'].append({'from_s': round(s / SR, 2), 'dur_s': round((e - s) / SR, 2), 'lufs_m_max': round(l, 1), 'peak_db': round(pk, 1)})
        counts[vid] = len(takes)
        print(f'{vid}: {len(y) / SR:.1f}秒 → {len(takes)}本 ' + ' '.join(f"{t['dur_s']}s/{t['lufs_m_max']}LUFS" for t in rec[vid]['takes']))
    if trial:
        print(f'✔（試し）{len(names)}語・{sum(counts.values())}本を {out_dir} に書いた'); return
    ip = os.path.join(ROOT, 'public', 'sound', 'index.json')
    idx = json.load(open(ip, encoding='utf-8')) if os.path.exists(ip) else {}
    idx.setdefault('se', {})
    idx['voice'] = counts
    json.dump(idx, open(ip, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump({'target_lufs_m_max': TARGET, 'peak_max_db': PEAK, 'silence_db': SILENCE_DB, 'gap_s': GAP_S, 'files': rec},
              open(os.path.join(ROOT, 'tools', 'sound', '声の記録.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'✔ {len(names)}語・{sum(counts.values())}本を public/sound/voice/ に書き出した')

if __name__ == '__main__':
    main()
