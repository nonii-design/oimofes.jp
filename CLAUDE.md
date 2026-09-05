# CLAUDE.md

このリポジトリは、WordPress で構築されていた https://oimofes.jp/ (おいもフェス) を
静的サイトとして複製し、AI と一緒に編集・更新していくためのものです。

## 構成

- `site/` — 公開される静的サイト本体 (HTML / CSS / JS / 画像)。編集対象はここ。
- `PAGES.md` — 全ページの URL・ファイルパス・タイトルの一覧。**ページを探すときはまずこれを読む。**
- `scripts/` — 元サイトの複製・後処理スクリプト。通常の編集作業では触らない。
- `.github/workflows/` — 複製 (mirror.yml) と公開 (deploy-pages.yml) のワークフロー。

## 編集ルール

1. **`site/` 内の HTML を直接編集する。** ビルド工程はない。保存した内容がそのまま公開される。
2. **リンクや画像のパスは相対パスのまま維持する。** `../wp-content/uploads/...` のような形式が正。
   `https://oimofes.jp/...` のような絶対 URL を新たに書かない。
3. **ヘッダー・フッター・ナビなど共通部分を変えるときは、全ページに同じ変更を適用する。**
   `PAGES.md` の一覧をもとに `site/**/*.html` を横断的に確認し、`Grep` で該当箇所を洗い出してから直す。
4. **CSS の変更は既存のテーマ CSS に追記するのではなく、`site/custom.css` を作り全ページから読み込む** 形を推奨する
   (元テーマ / ページビルダー Colibri の CSS は圧縮済みで巨大なため、直接編集すると差分が追えなくなる)。
   ページ固有のスタイルは各 HTML の `<head>` 内に `<style>` としてインラインで書かれているので、そちらは直接編集してよい。
5. **画像を追加するときは `site/wp-content/uploads/` 配下に置く。** 既存の構成に合わせる。
6. **`scripts/mirror.sh` を再実行すると `site/` が元サイトの内容で上書きされる。**
   手作業で編集を始めた後は、ユーザーの明確な指示なしに再実行しない。
7. **お問い合わせフォームは自前の実装に置き換え済み。**
   `site/contact-form.js` が Google Apps Script (`scripts/contact-form.gs`) へ送り、
   event@nonii.co.jp にメールで届く。見た目は `custom.css` の「お問い合わせフォーム」。
   WordPress 由来の他の動的機能 (検索、コメント) は静的サイトでは動かない。
8. **`<!-- INSTAGRAM:START -->` 〜 `<!-- INSTAGRAM:END -->` の中は手で編集しない。**
   `scripts/fetch-instagram.mjs` が 6 時間おきに自動生成している (2 か所ある)。
   表示件数を変えたいときはスクリプト冒頭の `SLOTS` を直す。
9. **画像を追加したら `python3 scripts/optimize-images.py` を実行する。**
   元サイトには表示サイズに対して極端に大きな画像が含まれていた
   (ヘッダーのロゴは 34035x13284px / 8.9MB)。長辺 2000px を上限に縮小する。
10. **各ページの `<head>` 先頭にある `id="oimo-boot"` のブロックは消さない。**
   スタイルシートが 20 個以上あり、読み込み途中の崩れた状態が見えてしまうため、
   準備ができるまで下地を黄色で覆ってからふわりと表示している。
   登場時の動きは `custom.css` の「ページ表示時のモーション」で定義している。
11. **HTML を大きく差し替えたら、`<div>` と `</div>` の数が合っているか必ず確認する。**
   Colibri の HTML は入れ子が深く、閉じタグを 1 つ落とすとページ全体のレイアウトが崩れる。

   ```bash
   python3 -c "import re;t=open('site/index.html',encoding='utf-8').read();b=t[t.find('<body'):];print(len(re.findall(r'<div\b',b))-len(re.findall(r'</div>',b)))"
   ```

   0 以外なら閉じタグが合っていない。

## サイトの特徴 (複製時点)

- テーマ / ページビルダー: **Colibri Page Builder Pro**。各ページの HTML は Colibri が生成した構造で、
  `class="h-section ..."` などのクラスとインライン `<style>` でレイアウトされている。
- 画像は `site/wp-content/uploads/YYYY/MM/` 配下。日本語ファイル名が多い。
  同じ画像に `-300x245` のようなサイズ違いの派生ファイルがあり、`srcset` で参照されている。
- 動的機能: 出店エントリーやアンケートは Google フォーム (`forms.gle`) への外部リンクなので静的化後も動く。
  ページ内の `/wp-admin/admin-ajax.php` への参照 (Colibri / 統計プラグイン由来) は動作しないが表示には影響しない。
- Google マップは iframe 埋め込みでそのまま動く。

## 確認方法

```bash
python3 -m http.server 8000 --directory site
```

で http://localhost:8000/ を開いて確認する。Playwright / Chromium が使える環境ではスクリーンショットで崩れを確認する。

## 複製をまだ実行していない場合

`site/index.html` がプレースホルダー (「まだ複製が実行されていません」) のままなら、
README.md の「ステップ 1」の手順で複製を実行するようユーザーに案内する。
この実行環境から `oimofes.jp` に接続できない場合は、GitHub Actions (mirror.yml) での実行を勧める。
