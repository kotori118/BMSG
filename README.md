# BMSG

BMSG Universe の移行先リポジトリ。フロントを Cloudflare Pages、データ API を Google Apps Script（JSON API）で動かす。

- 移行仕様書：https://docs.google.com/document/d/1gZl984HQkgk6r5XnxlxwjKedccoFV7lb_CcDMKFsGjc/edit
- Universe の仕様正本：https://docs.google.com/document/d/1pgttqIlZ8pZtBNBpKt90U_nr4ZVZyeCtJyYvBhu8QFk/edit
- 移行元：kotori118/BMSG-PJ、kotori118/BMSG-DB（main）。元のリポジトリ・スプレッドシートは変更しない。

## 構成

| パス | 内容 |
| :- | :- |
| `gas/` | Apps Script プロジェクト（clasp の rootDir）。ここにあるものだけが GAS に push される |
| `gas/Dispatcher.gs` | `doGet`／`doPost`。JSON API の入口（手で管理） |
| `gas/appsscript.json` | マニフェスト：`executeAs=USER_DEPLOYING`、`access=ANYONE_ANONYMOUS`（手で管理） |
| `gas/ApiActions.gs`、`gas/DbBridge.gs`、`gas/pj/`、`gas/db/` | 移行元から生成したコード。直接編集しない |
| `scripts/import-gas-sources.mjs` | 生成スクリプト |
| `docs/migration/` | 棚卸し（P0）と生成レポート |
| `web/` | フロント（Cloudflare Pages の出力ディレクトリ）。`index.html` は生成物 |
| `web/partials/` | 移行元 HTML の複製（生成物） |
| `web/js/gas-shim.js` | `google.script` の代替。画面のコードは変えずに JSON API を呼ぶ（手で管理） |
| `web/config.js` | API の URL（`/exec` で終わる Apps Script の URL）。デプロイ後に設定（手で管理） |
| `scripts/import-web-sources.mjs` | `web/` の生成スクリプト |
| `tests/` | GAS ソースの検証（`npm test`）。ブラウザの確認は `npm run test:browser` |

## API

- 読み取り：`GET <exec URL>?action=<名前>&args=<JSON配列>`（`ApiActions.gs` で `read: true` のものだけ）
- 書込み：`POST <exec URL>`、`Content-Type: text/plain`、本文 `{"action":"<名前>","args":[...]}`。`application/json` にするとブラウザがプリフライトを送り、GAS が応答しないため失敗する。
- 応答：`{"ok":true,"data":...}` または `{"ok":false,"error":{"code":"...","message":"..."}}`
- 引数は `google.script.run` のときと同じ並びで渡す。認証はなし（各 action の既存の userId 検査はそのまま）。

## フロントの生成

```sh
node scripts/import-web-sources.mjs <BMSG-PJのパス>
npm run test:browser   # Chromium が必要
```

PERFORMANCE TIMER の不整合（クライアント `'101'`、サーバー `'M101'`）は、生成時の置換で `'M101'` に揃える。置換は一致が1箇所のときだけ適用される。

## 生成し直す

```sh
npm install
node scripts/import-gas-sources.mjs <BMSG-PJのパス> <BMSG-DBのパス>
npm test
```

## デプロイ

`main` への push で `.github/workflows/deploy.yml` がテストを実行し、`gas/` を clasp で push・deploy する。Secrets `CLASPRC_JSON_KEY`、`SCRIPT_ID`、`DEPLOYMENT_ID` には新しい GAS プロジェクトの値を設定する。

初回デプロイ前に、旧 BMSG-DB プロジェクトの Script Properties（`UNIVERSE_CATALOG_BACKUP_ID`、`UNIVERSE_CATALOG_LOG_BACKUP_ID`、`UNIVERSE_CATALOG_BACKUP_HISTORY`）を新プロジェクトへ写す。
