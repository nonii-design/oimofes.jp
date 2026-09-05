#!/usr/bin/env node
// =============================================================================
// Instagram のアクセストークンの期限 (60日) を延長するスクリプト
//
//   INSTAGRAM_TOKEN=xxxx node scripts/refresh-instagram-token.mjs
//
// Instagram のトークンは 60 日で切れるが、期限内に refresh_access_token を呼ぶと
// そこから 60 日ぶんの新しいトークンが発行される。
// 6 時間おきに実行しておけば、手作業での再発行はいらなくなる。
//
// 新しいトークンを GitHub のシークレットに書き戻すには、シークレットを更新できる
// 権限を持つトークンが必要:
//   GH_TOKEN           Personal Access Token (Secrets: read and write 権限)
//   GITHUB_REPOSITORY  "owner/repo" (GitHub Actions が自動で設定する)
//
// GH_TOKEN が無い場合は、新しいトークンを保存せず「手動更新が必要」とだけ知らせて
// 終了する。トークンそのものはログに出さない。
// =============================================================================
import { createHash } from 'node:crypto';

const TOKEN = process.env.INSTAGRAM_TOKEN || '';
const GH_TOKEN = process.env.GH_TOKEN || '';
const REPO = process.env.GITHUB_REPOSITORY || '';
const SECRET_NAME = process.env.SECRET_NAME || 'INSTAGRAM_TOKEN';

if (!TOKEN) {
  console.log('==> INSTAGRAM_TOKEN が未設定のため、更新をスキップしました。');
  process.exit(0);
}

// --- 1. トークンを更新 ------------------------------------------------------
const url = 'https://graph.instagram.com/refresh_access_token'
  + `?grant_type=ig_refresh_token&access_token=${encodeURIComponent(TOKEN)}`;
const res = await fetch(url);
const body = await res.json().catch(() => ({}));

if (!res.ok || !body.access_token) {
  console.error(`!! トークンを更新できませんでした: ${body?.error?.message || `HTTP ${res.status}`}`);
  console.error('   期限切れの場合は README の手順で再発行し、シークレットを差し替えてください。');
  process.exit(1);
}

const days = Math.round((body.expires_in || 0) / 86400);
// トークン自体は出さず、識別用の短いハッシュだけを表示する
const fp = createHash('sha256').update(body.access_token).digest('hex').slice(0, 8);
console.log(`==> トークンを更新しました (残り約 ${days} 日 / 識別子 ${fp})`);

if (body.access_token === TOKEN) {
  console.log('==> 文字列は変わらなかったため、保存は不要です。');
  process.exit(0);
}

// --- 2. GitHub のシークレットへ書き戻す -------------------------------------
if (!GH_TOKEN || !REPO) {
  console.log('==> 新しいトークンが発行されましたが、保存先の権限がありません。');
  console.log(`    Settings → Secrets and variables → Actions の ${SECRET_NAME} を手動で更新してください。`);
  console.log('    自動化する場合は、Secrets の書き込み権限を持つ Personal Access Token を');
  console.log('    INSTAGRAM_TOKEN_WRITER というシークレットに登録してください。');
  process.exit(0);
}

// GitHub のシークレットはリポジトリ公開鍵で封をして送る必要がある。
// 封をする処理は GitHub 公式が案内している libsodium-wrappers を使う。
let sodium;
try {
  sodium = (await import('libsodium-wrappers')).default;
  await sodium.ready;
} catch {
  console.log('==> libsodium-wrappers が見つからないため、シークレットの自動更新をスキップしました。');
  console.log(`    Settings → Secrets and variables → Actions の ${SECRET_NAME} を手動で更新してください。`);
  process.exit(0);
}

const gh = async (p, init = {}) => {
  const r = await fetch(`https://api.github.com/repos/${REPO}${p}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${GH_TOKEN}`,
      'x-github-api-version': '2022-11-28',
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
  return r.status === 204 ? null : r.json();
};

const key = await gh('/actions/secrets/public-key');
const sealed = sodium.crypto_box_seal(
  sodium.from_string(body.access_token),
  sodium.from_base64(key.key, sodium.base64_variants.ORIGINAL),
);

await gh(`/actions/secrets/${SECRET_NAME}`, {
  method: 'PUT',
  body: JSON.stringify({
    encrypted_value: sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL),
    key_id: key.key_id,
  }),
});
console.log(`==> シークレット ${SECRET_NAME} を新しいトークンで更新しました。`);
