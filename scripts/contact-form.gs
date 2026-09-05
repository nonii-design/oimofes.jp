/**
 * おいもフェス お問い合わせフォームの受け口 (Google Apps Script)
 * =============================================================================
 * サイトのお問い合わせフォームから送信された内容を、
 * 指定のメールアドレスへ転送する。第三者のフォームサービスを使わず、
 * 自社の Google アカウント上だけで完結する。
 *
 * 特徴:
 *   - 差出人は自社アカウント、返信先 (Reply-To) は問い合わせ者のアドレス。
 *     Gmail でそのまま「返信」すれば、問い合わせ者に直接届く。
 *   - 受信内容はスプレッドシートにも記録する (任意)。
 *   - 添付ファイルにも対応 (上限あり)。
 *
 * 設置手順は README.md の「お問い合わせフォーム」を参照。
 * =============================================================================
 */

// ---- 設定 -------------------------------------------------------------------

/** 問い合わせの届け先 */
const TO_ADDRESS = 'event@nonii.co.jp';

/** 送信元として表示される名前 */
const SENDER_NAME = 'おいもフェス お問い合わせフォーム';

/**
 * 受信内容を記録するスプレッドシートの ID。
 * 空文字にすると記録しない (メール転送のみ)。
 * スプレッドシートの URL の /d/ と /edit の間の文字列。
 */
const SPREADSHEET_ID = '';

/** 添付ファイルの上限 (バイト)。これを超えるものは添付せず、本文に注記する。 */
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/**
 * 受け付けるサイトのオリジン。
 * 総当たりの投稿を減らすため、ここに載っていない場所からの送信は無視する。
 * 独自ドメインに切り替えたら 'https://oimofes.jp' を残して他を削ってよい。
 */
const ALLOWED_ORIGINS = [
  'https://oimofes.jp',
  'https://www.oimofes.jp',
  'https://nonii-design.github.io',
];

// ---- ここから下は通常は編集不要 ---------------------------------------------

/** お問い合わせ内容の選択肢。サイト側の value と対応させる。 */
const CATEGORY_LABELS = {
  'one': 'お客様',
  'two': '出店者様',
  'press': 'プレス・取材関係者様',
  'sponsor': '協賛企業様',
  'other': 'その他',
};

/**
 * フォームからの POST を受け取る。
 * text/plain で送ってもらうことで、ブラウザのプリフライト要求を避けている
 * (Apps Script はプリフライトに応答できないため)。
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // 空でなければ機械的な投稿とみなして捨てる (画面には出ていない項目)
    if (data.website) {
      return jsonResponse({ ok: true });
    }

    if (ALLOWED_ORIGINS.length && data.origin && ALLOWED_ORIGINS.indexOf(data.origin) === -1) {
      return jsonResponse({ ok: false, error: '受け付けられない送信元です。' });
    }

    const name = trim(data.name);
    const email = trim(data.email);
    const message = trim(data.message);

    if (!name || !email || !message) {
      return jsonResponse({ ok: false, error: '必須項目が入力されていません。' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ ok: false, error: 'メールアドレスの形式が正しくありません。' });
    }

    const category = CATEGORY_LABELS[data.category] || data.category || '(未選択)';
    const sentAt = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');

    const body = [
      'おいもフェスのサイトからお問い合わせが届きました。',
      'このメールにそのまま返信すると、お問い合わせいただいた方に届きます。',
      '',
      '─────────────────────────────',
      'お名前　　　: ' + name,
      'メール　　　: ' + email,
      'お問い合わせ: ' + category,
      '受信日時　　: ' + sentAt,
      '─────────────────────────────',
      '',
      message,
      '',
      '─────────────────────────────',
      '送信元ページ: ' + (trim(data.pageUrl) || '(不明)'),
    ].join('\n');

    const options = {
      name: SENDER_NAME,
      replyTo: email,  // Gmail で「返信」すると問い合わせ者に届く
    };

    const attachment = buildAttachment(data);
    if (attachment.blob) {
      options.attachments = [attachment.blob];
    }

    MailApp.sendEmail(
      TO_ADDRESS,
      '【お問い合わせ】' + category + ' / ' + name + ' 様',
      attachment.note ? body + '\n\n' + attachment.note : body,
      options
    );

    logToSheet([sentAt, name, email, category, message, trim(data.pageUrl), attachment.fileName || '']);

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error(err);
    return jsonResponse({ ok: false, error: '送信を処理できませんでした。' });
  }
}

/** 動作確認用。ブラウザで Web アプリの URL を開くとこれが返る。 */
function doGet() {
  return jsonResponse({ ok: true, message: 'おいもフェス お問い合わせフォームの受け口です。' });
}

function buildAttachment(data) {
  if (!data.fileName || !data.fileData) return { blob: null, note: '' };
  try {
    const bytes = Utilities.base64Decode(data.fileData);
    if (bytes.length > MAX_ATTACHMENT_BYTES) {
      return {
        blob: null,
        note: '※ 添付ファイル「' + data.fileName + '」は上限を超えていたため添付されていません。',
      };
    }
    const blob = Utilities.newBlob(bytes, data.fileType || 'application/octet-stream', data.fileName);
    return { blob: blob, note: '', fileName: data.fileName };
  } catch (err) {
    console.error(err);
    return { blob: null, note: '※ 添付ファイルを読み取れませんでした。' };
  }
}

function logToSheet(row) {
  if (!SPREADSHEET_ID) return;
  try {
    SpreadsheetApp.openById(SPREADSHEET_ID).getSheets()[0].appendRow(row);
  } catch (err) {
    console.error(err);  // 記録に失敗しても、メール送信自体は成功させる
  }
}

function trim(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
