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
| `scripts/postprocess.mjs` | 複製後の後処理 (WordPress 固有タグの除去、URL の整理、`PAGES.md` 生成) |
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
bash scripts/mirror.sh
node scripts/postprocess.mjs
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

## 将来の発展 (任意)

ページ数が多く、ヘッダー・フッターなどの共通部分を毎回全ページ書き換えるのが手間になってきたら、
`site/` の HTML を元に Astro などの静的サイトジェネレーターで
「共通パーツ + 各ページのコンテンツ」に分解する第 2 段階に進めます。
まずは本リポジトリの静的コピーで運用を始め、必要になった時点で検討してください。
