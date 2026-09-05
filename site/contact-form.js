/**
 * おいもフェス お問い合わせフォーム
 * ===========================================================================
 * 入力内容を Google Apps Script の受け口へ送り、event@nonii.co.jp に転送する。
 * 受け口のコードは scripts/contact-form.gs、設置手順は README.md を参照。
 *
 * 下の ENDPOINT を、Apps Script を「ウェブアプリ」として公開したときに
 * 発行される URL に差し替えると動きはじめる。
 * 未設定のあいだは、メールでのお問い合わせ先を案内する。
 * ===========================================================================
 */
(function () {
  'use strict';

  // 例: 'https://script.google.com/macros/s/AKfycb.../exec'
  var ENDPOINT = '';

  var MAIL_TO = 'event@nonii.co.jp';
  var MAX_FILE_BYTES = 8 * 1024 * 1024;

  var form = document.getElementById('oimo-contact');
  if (!form) return;

  var status = document.getElementById('oimo-status');
  var submit = form.querySelector('.oimo-form__submit');
  var message = document.getElementById('oimo-message');
  var counter = document.getElementById('oimo-count');
  var fileInput = document.getElementById('oimo-file');

  // 文字数の表示
  if (message && counter) {
    message.addEventListener('input', function () {
      counter.textContent = String(message.value.length);
    });
  }

  function show(text, kind) {
    if (!status) return;
    status.textContent = text;
    status.className = 'oimo-form__note' + (kind ? ' is-' + kind : '');
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        // "data:<type>;base64,xxxx" の xxxx の部分だけを取り出す
        var result = String(reader.result);
        resolve(result.slice(result.indexOf(',') + 1));
      };
      reader.onerror = function () { reject(new Error('read failed')); };
      reader.readAsDataURL(file);
    });
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();

    var name = form.elements.name.value.trim();
    var email = form.elements.email.value.trim();
    var body = form.elements.message.value.trim();

    if (!name || !email || !body) {
      show('お名前・メールアドレス・メッセージをご入力ください。', 'error');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      show('メールアドレスの形式をご確認ください。', 'error');
      return;
    }

    var file = fileInput && fileInput.files && fileInput.files[0];
    if (file && file.size > MAX_FILE_BYTES) {
      show('ファイルは 8MB までです。大きい場合はメールでお送りください。', 'error');
      return;
    }

    if (!ENDPOINT) {
      show('現在フォームの準備中です。お手数ですが ' + MAIL_TO + ' 宛にメールでお問い合わせください。', 'error');
      return;
    }

    submit.disabled = true;
    show('送信しています…', 'busy');

    var payload = {
      name: name,
      email: email,
      category: form.elements.category.value,
      message: body,
      website: form.elements.website.value,   // 空でなければ機械的な投稿
      origin: window.location.origin,
      pageUrl: window.location.href,
    };

    var prepare = file
      ? fileToBase64(file).then(function (b64) {
          payload.fileName = file.name;
          payload.fileType = file.type;
          payload.fileData = b64;
        })
      : Promise.resolve();

    prepare
      .then(function () {
        // text/plain で送ると、ブラウザの事前確認 (プリフライト) が発生しない。
        // Apps Script は事前確認に応答できないため、この形にしている。
        return fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
        });
      })
      .then(function (res) { return res.json(); })
      .then(function (result) {
        if (result && result.ok) {
          form.reset();
          if (counter) counter.textContent = '0';
          show('送信しました。お問い合わせありがとうございます。折り返しご連絡いたします。', 'done');
        } else {
          show((result && result.error) || '送信できませんでした。' + MAIL_TO + ' 宛にメールでお問い合わせください。', 'error');
        }
      })
      .catch(function () {
        show('送信できませんでした。お手数ですが ' + MAIL_TO + ' 宛にメールでお問い合わせください。', 'error');
      })
      .then(function () {
        submit.disabled = false;
      });
  });
})();
