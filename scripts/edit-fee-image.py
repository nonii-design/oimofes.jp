#!/usr/bin/env python3
"""入場料の画像から、実態に合わなくなった「(おいもシールTICKET)」を外す。

    python3 scripts/edit-fee-image.py

入場料は 2026 年からシールではなく入場バンドに変わった。帯の見出しにある
「入場料 (おいもシールTICKET)」の括弧の中が誤りになったため、括弧ごと外して
「入場料」だけにし、帯の中央にそろえ直す。

「入場料」は元の画像の画素をそのまま移すだけで、文字を描き直していない
(元画像の書体は Corporate Logo より太く、手元のフォントでは再現できないため)。
帯は単色 (#4f2224) なので、消した跡は同じ色で塗れば継ぎ目は出ない。

入場バンドであることは、画像ではなく index.html の文章で伝えている。
"""
from PIL import Image, ImageDraw

SRC = 'site/wp-content/uploads/2026/09/入場料.png'
BROWN = (79, 34, 36, 255)

# 元画像で測った値
BAR_CENTER_X = 319.5      # 帯 (x 50-589) の中央
KANJI_BOX = (171, 25, 264, 56)   # 「入場料」を余白ごと切り取る範囲
KANJI_INK = (173, 27, 262, 54)   # その中のインクの範囲 (89 x 27)

im = Image.open(SRC).convert('RGBA')
kanji = im.crop(KANJI_BOX)
ink_w = KANJI_INK[2] - KANJI_INK[0]
dx = KANJI_INK[0] - KANJI_BOX[0]
dy = KANJI_INK[1] - KANJI_BOX[1]

# 帯の中の文字を消す (左右の丸い点 x70-78 / x561-569 には触れない)
ImageDraw.Draw(im).rectangle([150, 20, 500, 60], fill=BROWN)

x0 = round(BAR_CENTER_X - ink_w / 2)
im.paste(kanji, (x0 - dx, KANJI_INK[1] - dy), kanji)
im.save(SRC, optimize=True)
print(f'{SRC}: 「入場料」を x {x0}-{x0 + ink_w - 1} に置き直しました (中央 {x0 + ink_w / 2})')
