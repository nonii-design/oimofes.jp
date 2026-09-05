#!/usr/bin/env python3
# =============================================================================
# site/ 内の画像を Web 向けに軽量化するスクリプト
#
#   python3 scripts/optimize-images.py
#   python3 scripts/optimize-images.py --dry-run     # 変更せず結果だけ表示
#
# 背景:
#   元の WordPress には、表示サイズに対して極端に大きな画像が入っていた。
#   例: ヘッダーのロゴは 34035x13284 px (4億5千万画素 / 8.9MB) あるが、
#       実際には 120px 幅で表示している。
#   ブラウザはこれを展開するのに 1GB を超えるメモリを使うため、
#   読み込みが遅くなり、表示が段階的に崩れて見える原因になっていた。
#
# やること:
#   1. 長辺が MAX_EDGE を超える画像を縮小する (見た目の解像度は十分に保つ)
#   2. PNG は可逆で再圧縮、JPEG は品質 QUALITY で再保存する
#   3. 元より小さくなった場合だけ書き戻す (悪化させない)
#
# 注意:
#   scripts/mirror.sh を再実行すると元の巨大な画像に戻るため、
#   複製のたびにこのスクリプトも実行すること (mirror.yml に組み込み済み)。
# =============================================================================
import argparse
import os
import sys

from PIL import Image

# 巨大な画像を開くために上限を外す (信頼できる自サイトの画像のみを扱うため)
Image.MAX_IMAGE_PIXELS = None

MAX_EDGE = 2000      # 長辺の上限 (px)。高解像度画面でも十分な大きさ
JPEG_QUALITY = 85    # JPEG の再保存品質 (見た目の劣化がほぼ分からない範囲)
MIN_SAVING = 1024    # これ未満しか減らない場合は書き換えない (バイト)

EXTS = {".png", ".jpg", ".jpeg"}


def human(n: int) -> str:
    return f"{n / 1024 / 1024:.1f}MB" if n >= 1024 * 1024 else f"{n // 1024}KB"


def optimize(path: str, dry_run: bool) -> tuple[int, int, str]:
    """1 ファイルを処理し、(元のサイズ, 新しいサイズ, 説明) を返す。"""
    before = os.path.getsize(path)
    ext = os.path.splitext(path)[1].lower()

    try:
        im = Image.open(path)
        im.load()
    except Exception as e:  # 壊れた画像は触らない
        return before, before, f"スキップ ({e.__class__.__name__})"

    note = ""
    if max(im.width, im.height) > MAX_EDGE:
        w, h = im.width, im.height
        scale = MAX_EDGE / max(w, h)
        im = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
        note = f"{w}x{h} → {im.width}x{im.height}"

    tmp = path + ".opt"
    try:
        if ext == ".png":
            im.save(tmp, "PNG", optimize=True)
        else:
            if im.mode in ("RGBA", "P", "LA"):
                im = im.convert("RGB")
            im.save(tmp, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
    except Exception as e:
        if os.path.exists(tmp):
            os.remove(tmp)
        return before, before, f"スキップ ({e.__class__.__name__})"

    after = os.path.getsize(tmp)
    if after >= before - MIN_SAVING:
        os.remove(tmp)
        return before, before, ""

    if dry_run:
        os.remove(tmp)
    else:
        os.replace(tmp, path)
    return before, after, note or "再圧縮"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="site", help="対象ディレクトリ (既定: site)")
    ap.add_argument("--dry-run", action="store_true", help="変更せず結果だけ表示する")
    args = ap.parse_args()

    targets = []
    for root, _dirs, files in os.walk(args.dir):
        for f in files:
            if os.path.splitext(f)[1].lower() in EXTS:
                targets.append(os.path.join(root, f))
    targets.sort(key=os.path.getsize, reverse=True)

    total_before = total_after = 0
    changed = []
    for path in targets:
        b, a, note = optimize(path, args.dry_run)
        total_before += b
        total_after += a
        if a < b:
            changed.append((b - a, path, note))

    changed.sort(reverse=True)
    print(f"==> 対象 {len(targets)} 件 / 軽量化 {len(changed)} 件"
          + ("  (--dry-run のため書き換えていません)" if args.dry_run else ""))
    for saved, path, note in changed[:15]:
        print(f"   -{human(saved):>7}  {os.path.relpath(path, args.dir)}  {note}")
    if len(changed) > 15:
        print(f"   ... ほか {len(changed) - 15} 件")
    print(f"==> 合計 {human(total_before)} → {human(total_after)} "
          f"({human(total_before - total_after)} 削減)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
