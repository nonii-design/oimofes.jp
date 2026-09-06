#!/usr/bin/env python3
# =============================================================================
# コーポレート・ロゴ (OTF) を、サイトで使う文字だけに絞って WOFF2 に変換する
#
#   python3 scripts/build-fonts.py
#
# 元の OTF は 1 書体 2.7MB あり、そのまま配信すると重すぎる。
# サイト内の HTML に実際に出てくる文字 + ひらがな/カタカナ/英数字/記号 に絞ると
# 数十〜百数十 KB に収まる。ここに無い漢字は本文用の Noto Sans JP で表示される。
#
# 元ファイルの置き場所: fonts-src/ (git には含めない。再配布を避けるため)
# 出力先:             site/fonts/
# 文章を大きく増やしたら再実行すること。
# =============================================================================
import glob, html, os, re, sys
from fontTools.ttLib import TTFont
from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.environ.get('FONT_SRC', os.path.join(ROOT, 'fonts-src'))
OUT_DIR = os.path.join(ROOT, 'site', 'fonts')
FONTS = [  # (元ファイル, 出力名)
    ('CorporateLogoMediumver3.otf', 'corporate-logo-medium.woff2'),
    ('CorporateLogoBoldver3.otf',   'corporate-logo-bold.woff2'),
]

def site_chars() -> set[str]:
    chars = set()
    for p in glob.glob(os.path.join(ROOT, 'site', '**', '*.html'), recursive=True):
        t = open(p, encoding='utf-8').read()
        b = t[t.find('<body'):] if '<body' in t else t
        b = re.sub(r'<script[\s\S]*?</script>|<style[\s\S]*?</style>|<!--[\s\S]*?-->', '', b)
        txt = re.sub(r'<[^>]+>', ' ', b)
        txt += ' '.join(re.findall(r'(?:alt|title|placeholder|aria-label|value)="([^"]*)"', b))
        chars.update(html.unescape(txt))
        m = re.search(r'<title>([^<]*)', t)
        if m: chars.update(html.unescape(m.group(1)))
    # 店舗名などで増える可能性に備え、基本文字は常に含める
    for lo, hi in [(0x20, 0x7E), (0x3040, 0x309F), (0x30A0, 0x30FF), (0xFF01, 0xFF60), (0x3000, 0x303F),
                   (0x2010, 0x2027), (0x2030, 0x205E), (0x00A9, 0x00AE), (0x00B0, 0x00B0), (0x00D7, 0x00D7),
                   (0x2190, 0x2199), (0x25A0, 0x25FF), (0x2460, 0x2473)]:
        chars.update(chr(c) for c in range(lo, hi + 1))
    return {c for c in chars if ord(c) >= 0x20 and c != '\x7f'}

def main() -> int:
    os.makedirs(OUT_DIR, exist_ok=True)
    chars = site_chars()
    text = ''.join(sorted(chars))
    print(f'==> 収録する文字: {len(chars)} 字 (うち漢字 {sum(1 for c in chars if 0x4E00 <= ord(c) <= 0x9FFF)})')
    for src, out in FONTS:
        path = os.path.join(SRC_DIR, src)
        if not os.path.exists(path):
            print(f'!! 元ファイルがありません: {path}  (環境変数 FONT_SRC で場所を指定できます)'); return 1
        f = TTFont(path)
        fs = f['OS/2'].fsType
        print(f'   {src}: 埋め込み許可 fsType={fs} ({"制限なし" if fs == 0 else "要確認"}), グリフ {len(f.getGlyphOrder())}')
        opts = subset.Options()
        opts.flavor = 'woff2'
        opts.layout_features = ['*']
        opts.name_IDs = ['*']
        opts.notdef_outline = True
        opts.drop_tables += ['DSIG']
        sub = subset.Subsetter(options=opts)
        sub.populate(text=text)
        sub.subset(f)
        outp = os.path.join(OUT_DIR, out)
        f.save(outp)
        print(f'   → site/fonts/{out}  {os.path.getsize(outp)//1024} KB  (元 {os.path.getsize(path)/1024/1024:.1f} MB)')
    return 0

if __name__ == '__main__':
    sys.exit(main())
