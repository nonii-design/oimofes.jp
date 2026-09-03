#!/usr/bin/env bash
# =============================================================================
# WordPress サイトを静的 HTML として site/ に丸ごと複製するスクリプト
#
# 使い方:
#   bash scripts/mirror.sh
#   SITE_URL=https://example.com/ bash scripts/mirror.sh
#
# 環境変数:
#   SITE_URL     複製元サイトの URL           (既定: https://oimofes.jp/)
#   OUT_DIR      出力先ディレクトリ           (既定: site)
#   EXTRA_HOSTS  画像や CSS を別ホスト (CDN など) から配信している場合、
#                そのホスト名をカンマ区切りで指定 (例: cdn.example.com,i0.wp.com)
#   WAIT         リクエスト間の待ち時間 [秒]  (既定: 0.3) サーバー負荷を抑えるため
#
# 補足:
#   - リンクで辿れないページ (どこからもリンクされていないページ) は
#     scripts/extra-urls.txt に 1 行 1 URL で書いておくと開始点に追加されます。
#   - 実行後は node scripts/postprocess.mjs で後処理を行ってください。
# =============================================================================
set -euo pipefail

SITE_URL="${SITE_URL:-https://oimofes.jp/}"
OUT_DIR="${OUT_DIR:-site}"
EXTRA_HOSTS="${EXTRA_HOSTS:-}"
WAIT="${WAIT:-0.3}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTRA_URLS_FILE="$SCRIPT_DIR/extra-urls.txt"

HOST="$(printf '%s' "$SITE_URL" | sed -E 's#^https?://([^/:]+).*#\1#')"
DOMAINS="$HOST,www.$HOST"
if [ -n "$EXTRA_HOSTS" ]; then
  DOMAINS="$DOMAINS,$EXTRA_HOSTS"
fi

mkdir -p "$OUT_DIR"

INPUT_ARGS=()
if [ -s "$EXTRA_URLS_FILE" ]; then
  # コメント行と空行を除いた URL 一覧を開始点として渡す
  TMP_URLS="$(mktemp)"
  grep -Ev '^\s*(#|$)' "$EXTRA_URLS_FILE" > "$TMP_URLS" || true
  if [ -s "$TMP_URLS" ]; then
    INPUT_ARGS=(--input-file="$TMP_URLS")
  fi
fi

echo "==> Mirroring $SITE_URL into $OUT_DIR/ (domains: $DOMAINS)"

# wget の終了コード 8 は「一部の URL がサーバーエラー (404 など) だった」の意味。
# WordPress サイトでは壊れたリンクが 1 つでもあると必ず 8 になるため、8 は成功扱いにする。
set +e
wget \
  --recursive --level=inf \
  --page-requisites \
  --adjust-extension \
  --convert-links \
  --no-parent \
  --span-hosts --domains="$DOMAINS" \
  --no-host-directories \
  --directory-prefix="$OUT_DIR" \
  --restrict-file-names=windows \
  --reject-regex='(wp-login\.php|/wp-admin/|xmlrpc\.php|/wp-json/|\?replytocom=|/feed/?$|/feed/[a-z]+/?$|\?s=|/comments/|\?share=|/trackback/?$|/embed/?$|\?p=[0-9]+$)' \
  --execute robots=off \
  --wait="$WAIT" \
  --timeout=30 --tries=3 \
  --user-agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 oimofes-mirror" \
  --no-verbose \
  "${INPUT_ARGS[@]}" \
  "$SITE_URL"
STATUS=$?
set -e

if [ "$STATUS" -ne 0 ] && [ "$STATUS" -ne 8 ]; then
  echo "!! wget failed with exit code $STATUS" >&2
  exit "$STATUS"
fi

# GitHub Pages で Jekyll 処理を無効化 (アンダースコア始まりのパスもそのまま配信する)
touch "$OUT_DIR/.nojekyll"

HTML_COUNT="$(find "$OUT_DIR" -type f -name '*.html' | wc -l | tr -d ' ')"
TOTAL_SIZE="$(du -sh "$OUT_DIR" | cut -f1)"
echo "==> Done. HTML pages: $HTML_COUNT, total size: $TOTAL_SIZE"
echo "==> Next: node scripts/fetch-missing.mjs && node scripts/postprocess.mjs"
