# oimofes.jp

WordPress で構築されていた <https://oimofes.jp/> を **静的サイトとして丸ごと複製** し、
このリポジトリ上で AI (Claude Code) と一緒にデザイン・コンテンツを修正・更新していくためのリポジトリです。

## 考え方

WordPress は「テーマ + データベース + PHP」で構成されているため、そのままでは AI が Git 上で編集できません。
そこで、公開されている **最終的な HTML / CSS / JS / 画像** をそのまま取り込んだ「静的サイト」に変換します。

```
WordPress (oimofes.jp)  ──複製──▶  site/ (静的 HTML)  ──AI で編集──▶  GitHub Pages 等で公開
```

- 見た目・文章・画像は元サイトと同一のものが `site/` に入る
- サーバー・DB・PHP・プラグイン更新が不要になり、Git で履歴管理できる
- Claude Code に「トップページのキャッチコピーを○○に変えて」「開催日程を更新して」と頼めばそのまま編集できる

## ディレクトリ構成

| パス | 内容 |
|---|---|
| `site/` | 複製された静的サイト本体。**公開されるのはこの中身だけ** |
| `PAGES.md` | 全ページの一覧 (URL・ファイル・タイトル)。複製時に自動生成 |
| `scripts/mirror.sh` | 元サイトを `site/` に複製するスクリプト (wget) |
| `scripts/fetch-missing.mjs` | 遅延読み込み (lazyload) の画像など、wget が取りこぼした素材を追加取得 |
| `scripts/fetch-instagram.mjs` | Instagram の最新投稿を取り込み、トップページの埋め込みを更新 |
| `scripts/refresh-instagram-token.mjs` | Instagram トークンの 60 日期限を自動で延長 |
| `scripts/optimize-images.py` | 表示サイズに対して大きすぎる画像を Web 向けに縮小 |
| `scripts/postprocess.mjs` | 複製後の後処理 (WordPress 固有タグの除去、URL の相対化、ファイル名の整理、`PAGES.md` 生成) |
| `scripts/extra-urls.txt` | どこからもリンクされていないページがあれば URL を追記 |
| `.github/workflows/mirror.yml` | GitHub 上のボタンで複製を実行するワークフロー |
| `.github/workflows/deploy-pages.yml` | `site/` を GitHub Pages に公開するワークフロー |
| `CLAUDE.md` | AI が編集する際のルール |

## ステップ 1: サイトを複製する

次の 3 つのうち、いずれか 1 つを実行してください。**GitHub Actions で実行する方法 (A) が最も簡単です。**

### A. GitHub Actions で実行する (推奨・ブラウザだけで完了)

1. GitHub のリポジトリページ → **Actions** タブ → 左の **Mirror WordPress site**
2. 右側の **Run workflow** → ブランチを選び (`claude/wordpress-site-clone-ai-itlcmw` または `main`) → **Run workflow**
3. 数分待つと `site/` と `PAGES.md` が自動でコミットされます

### B. Claude Code (Web 版) から実行する

Claude Code の実行環境は初期状態で外部サイトへのアクセスが制限されています。
環境設定 (Environment) のネットワーク設定で `oimofes.jp` を許可してから
「`scripts/mirror.sh` を実行して複製してください」と依頼すれば、Claude が代行します。
設定方法: <https://code.claude.com/docs/en/claude-code-on-the-web>

### C. 自分の PC で実行する

wget と Node.js 18 以上が必要です (Mac: `brew install wget node`)。

```bash
git clone https://github.com/nonii-design/oimofes.jp.git
cd oimofes.jp
bash scripts/mirror.sh          # wget でページと画像を取得
node scripts/fetch-missing.mjs  # 遅延読み込み画像など wget が取りこぼしたものを追加取得
node scripts/postprocess.mjs    # 後処理 (不要タグ除去・パス整理・PAGES.md 生成)
git add -A site PAGES.md
git commit -m "chore: mirror oimofes.jp"
git push
```

### 複製後に確認すること

- `PAGES.md` を開いて、想定しているページがすべて含まれているか確認する。
  足りないページは `scripts/extra-urls.txt` に URL を書いて再実行してください。
- 画像が別ドメイン (CDN や `i0.wp.com` など) から配信されていた場合は、
  `EXTRA_HOSTS=cdn.example.com bash scripts/mirror.sh` のようにホストを追加して再実行してください
  (GitHub Actions の場合は "extra_hosts" 欄に入力)。
- ローカルで確認する場合:

  ```bash
  python3 -m http.server 8000 --directory site
  # ブラウザで http://localhost:8000/ を開く
  ```

## ステップ 2: 公開する (任意)

`site/` は普通の静的ファイルなので、どの静的ホスティングにも置けます。

- **GitHub Pages**: リポジトリの Settings → Pages → Source を **GitHub Actions** にすると、
  `main` ブランチの `site/` が変更されるたびに自動で公開されます。
  独自ドメイン (oimofes.jp) を使う場合は同じ画面の Custom domain に設定し、DNS を GitHub Pages に向けます。
- **Cloudflare Pages / Netlify / Vercel**: 「ビルドコマンドなし・公開ディレクトリ `site`」で設定するだけです。

## ステップ 3: AI で修正・更新していく

複製が終わったら、Claude Code にそのまま依頼できます。例:

- 「トップページのヒーロー画像の下にある文章を〇〇に変更して」
- 「開催概要ページの日程を 2026 年版に更新して」
- 「全ページのフッターに Instagram のリンクを追加して」
- 「スマホ表示でナビゲーションが崩れているので直して」

編集ルールは `CLAUDE.md` に書いてあります (AI が自動で読みます)。

## 静的化にあたっての注意点

静的サイトになると、WordPress の **サーバー側で動いていた機能** はそのままでは動きません。

| 機能 | 対応方針 |
|---|---|
| お問い合わせフォーム (Contact Form 7 など) | Google フォーム、Formspree、Netlify Forms などに置き換える |
| サイト内検索 | 削除するか、Pagefind などの静的検索に置き換える |
| コメント欄 | 削除する (イベントサイトでは通常不要) |
| 管理画面からの記事投稿 | Claude Code に依頼して HTML を追加する運用に変わる |

これらは複製後に、`PAGES.md` を見ながら該当箇所を Claude Code に修正依頼してください。

## お問い合わせフォーム

トップページのお問い合わせフォームは、送信内容を **event@nonii.co.jp** にメールで届けます。
外部のフォームサービスは使わず、**自社の Google アカウント上の Google Apps Script** が受け取ります。

届いたメールは **返信先 (Reply-To) が問い合わせ者のアドレス** になっているので、
Gmail でそのまま「返信」すれば相手に直接届きます。

| ファイル | 役割 |
|---|---|
| `site/contact-form.js` | フォームの送信処理。先頭の `ENDPOINT` に受け口の URL を入れる |
| `scripts/contact-form.gs` | Google Apps Script に貼り付けるコード（届け先の設定もここ） |

**受け口の URL を設定するまでは、フォームは「準備中」と表示し、メールでの問い合わせ先を案内します。**

### 設置手順（10 分ほど）

1. <https://script.google.com/> を開き、**event@nonii.co.jp を管理できる Google アカウント**でログインする
2. **「新しいプロジェクト」** を作成し、プロジェクト名を `oimofes-contact` などにする
3. 左のエディタの中身をすべて消し、`scripts/contact-form.gs` の内容をそのまま貼り付けて保存する
4. 右上の **「デプロイ」→「新しいデプロイ」** を選ぶ
5. 歯車マークから種類に **「ウェブアプリ」** を選び、以下を設定する
   - 次のユーザーとして実行: **自分**
   - アクセスできるユーザー: **全員**
6. **「デプロイ」** を押す。初回は権限の確認が出るので許可する
   （「このアプリは確認されていません」と出たら、「詳細」→「安全ではないページに移動」で進める。自分で書いたコードなので問題ない）
7. 表示された **ウェブアプリの URL**（`https://script.google.com/macros/s/.../exec`）をコピーする
8. `site/contact-form.js` の 1 行目付近にある `var ENDPOINT = '';` に、その URL を貼り付ける
9. コミットして反映すれば完了

### 動作の確認

サイトのお問い合わせフォームから実際に送信し、event@nonii.co.jp に届くか確認してください。
届いたメールに Gmail から返信し、問い合わせ者のアドレス宛になっていることも確認できます。

### 設定を変えたいとき

`scripts/contact-form.gs` の先頭で変更できます。変更後は **再度デプロイ** が必要です
（「デプロイ」→「デプロイを管理」→ 鉛筆マーク → バージョンを「新バージョン」→「デプロイ」）。

- `TO_ADDRESS` — 届け先のアドレス
- `SPREADSHEET_ID` — 問い合わせ内容をスプレッドシートにも記録したい場合に設定
- `ALLOWED_ORIGINS` — 受け付けるサイトの URL。独自ドメイン切り替え後は `https://oimofes.jp` のみでよい

### 迷惑投稿への対策

画面に見えない項目を 1 つ置き、そこに入力があった送信は捨てています。
それでも迷惑メールが増えるようなら、Google の reCAPTCHA を足せます。

## Instagram の埋め込み

トップページの Instagram 欄 2 か所は、**6 時間おきに @oimo.fes の最新投稿を取り込んで自動更新** します
(`.github/workflows/instagram.yml`)。投稿画像はリポジトリ内に保存するので、
Instagram 側の画像 URL が期限切れになっても表示は崩れません。

**動かすにはアクセストークンの登録が 1 回だけ必要です。** 未登録のあいだは、
アカウントへのリンクだけが表示されます (エラーにはなりません)。

### トークンの取り方

1. Instagram アプリで @oimo.fes を **プロアカウント (ビジネス or クリエイター)** に切り替える
   （設定 → アカウントの種類とツール → プロアカウントに切り替える）
2. <https://developers.facebook.com/apps/> で **アプリを作成** する
   （ユースケースは「Instagram」→「Instagram API setup with Instagram login」）
3. アプリの Instagram 設定画面で **「Generate token」** を押し、@oimo.fes でログインして
   表示された長いトークンをコピーする
4. GitHub のリポジトリ → **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `INSTAGRAM_TOKEN`
   - Secret: コピーしたトークン
5. **Actions → Update Instagram feed → Run workflow** で動作を確認する

### トークンの期限について

Instagram のトークンは 60 日で切れますが、上のワークフローは実行のたびに期限を延長するので、
**通常は放置で動き続けます**。

延長後の新しいトークンをシークレットに自動保存するには、
Secrets の書き込み権限を持つ Personal Access Token を `INSTAGRAM_TOKEN_WRITER` という名前で
登録してください。登録しない場合も期限延長自体は行われますが、
まれに文字列が変わったときだけ手動での差し替えが必要になります。

### 手元で試す

```bash
INSTAGRAM_TOKEN=xxxxx node scripts/fetch-instagram.mjs
```

### 表示件数を変えたい

`scripts/fetch-instagram.mjs` の先頭にある `SLOTS` で、
2 か所それぞれの枚数 (既定 4 枚 / 7 枚) を変更できます。

## 共通部品 (ヘッダー / フッター) と店舗一覧

繰り返し出てくる部分は 1 か所を直せば全ページに反映されるようにしています。

| 直したいもの | 編集するファイル | そのあと実行するコマンド |
| --- | --- | --- |
| メニューの項目、ロゴ、フッターのリンク | `partials/header.html` / `partials/footer.html` | `node scripts/sync-partials.mjs` |
| 出店店舗の追加・削除・並び替え | `data/shops.json` | `node scripts/build-shops.mjs` |

- 各ページの `<!-- HEADER:START -->` … `<!-- HEADER:END -->` などのマーカーの間はスクリプトが書き込むので、
  直接編集しても次の実行で上書きされます。
- `data/shops.json` の各店舗は `name` (店名)、`area` (都道府県・任意)、`image` (site/ からの相対パス)、
  `link` (Instagram の投稿など・任意) を持ちます。画像は `site/wp-content/uploads/` に置き、
  先に `python3 scripts/optimize-images.py` を実行しておくと縮小版が自動で `srcset` に入ります。
- トップページ (`site/index.html`) は WordPress のページビルダーに依存しない軽い HTML に書き直しています。
  jQuery や Swiper などは読み込まず、見た目は `site/custom.css`、動きは `site/oimo-ui.js` だけで完結します。
  下層ページは複製時の構造 (Colibri) のままですが、ヘッダーとフッターは上の共通部品に置き換えています。

## 出店者募集の表示期間

トップページの「出店者募集」(`#entry`) は、エントリー受付の期間だけ表示できます。
`site/index.html` の該当セクションにある 2 つの属性に日付を入れてください。

```html
<section class="oimo-section oimo-entry" id="entry"
         data-oimo-from="2026-01-20" data-oimo-to="2026-01-31">
```

- 開始日の 0:00 から終了日の終わりまで表示され、それ以外の期間は自動的に隠れます。
- 日付を入れると「エントリー受付期間：1月20日（火）〜1月31日（土）」の行も自動で表示されます。
- 両方を空 (`data-oimo-from=""`) にすると常に表示されます。
- エントリーの誘導先は出店者ポータル (https://event-portal.nonii.co.jp/) です。リンク先を変えるときは
  同じセクションの `<a class="h-button" href="...">` を書き換えてください。

同じ属性は他のブロックにも使えます (期間限定のお知らせなど)。仕組みは `site/oimo-ui.js` の「表示期間」にあります。

## フォント

ブランド書体「コーポレート・ロゴ ver3」(Medium / Bold) を Web フォントとして配信しています。

- `site/fonts/corporate-logo-medium.woff2` / `corporate-logo-bold.woff2` — サイト内で使われている文字だけを
  抜き出したサブセット (各 300KB 台)。`site/custom.css` の `@font-face` から読み込みます。
- 元の OTF は `fonts-src/` に置きます。ライセンス上の再配布を避けるため Git には含めません (`.gitignore` 済み)。
- 文章を大きく追加・変更してサブセットに無い文字が出てきたら、`fonts-src/` に OTF を置いた状態で

  ```bash
  pip install fonttools brotli
  python3 scripts/build-fonts.py
  ```

  を実行すると `site/fonts/` が作り直されます。無い文字は代替の Noto Sans JP で表示されるだけで、崩れはしません。
- 本文は Google Fonts の Noto Sans JP。以前テーマが読み込んでいた欧文 6 書体と M PLUS Rounded 1c は外しました。

## 将来の発展 (任意)

ページ数が多く、ヘッダー・フッターなどの共通部分を毎回全ページ書き換えるのが手間になってきたら、
`site/` の HTML を元に Astro などの静的サイトジェネレーターで
「共通パーツ + 各ページのコンテンツ」に分解する第 2 段階に進めます。
まずは本リポジトリの静的コピーで運用を始め、必要になった時点で検討してください。
