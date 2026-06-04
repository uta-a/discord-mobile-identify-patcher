# Discord Mobile IDENTIFY Patcher

Discord Desktop の Gateway `IDENTIFY` を Android 風の値に書き換えて、モバイル表示を狙う実験的なパッチャーです。

Discord のクライアントファイルを変更するため、Discord の規約に反する可能性や、Discord/Vencord の更新で壊れる可能性があります。インストール中は Discord を閉じてください。

## 対応範囲

- Discord の `resources` ディレクトリに対して手動またはスクリプトでインストールする
- `app.asar` に自作 loader を置く
- 公式 Discord のみの場合は、公式 `app.asar` を `_app.asar` に退避する
- Vencord 形式の `_app.asar` がある場合は、Vencord loader を `app.vc.asar` に退避して Vencord を残す
- `app.dmi.asar` は移行用/フォールバック用として扱う
- `marker.json` で二重インストールを防ぐ
- WebSocket の Gateway `IDENTIFY` (`op: 2`) だけを書き換える

GUI、正式なアンインストーラー、自動更新機能はまだありません。

## インストール

インストーラーは対話式です。検出した Discord を表示し、対象・モード・Discord を閉じるかどうかを確認してからパッチします。

Windows PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/uta-a/discord-mobile-identify-patcher/main/scripts/bootstrap-windows.ps1 | iex"
```

macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/uta-a/discord-mobile-identify-patcher/main/scripts/bootstrap-macos.sh | bash
```

Canary や PTB に当てる場合:

```powershell
$env:DMI_BRANCH = "canary"; powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/uta-a/discord-mobile-identify-patcher/main/scripts/bootstrap-windows.ps1 | iex"; Remove-Item Env:\DMI_BRANCH
```

```bash
curl -fsSL https://raw.githubusercontent.com/uta-a/discord-mobile-identify-patcher/main/scripts/bootstrap-macos.sh | bash -s -- canary
```

プロンプトなしで実行する場合は `DMI_NONINTERACTIVE=1` を使います。

```bash
DMI_NONINTERACTIVE=1 curl -fsSL https://raw.githubusercontent.com/uta-a/discord-mobile-identify-patcher/main/scripts/bootstrap-macos.sh | bash
```

## インストールモード

既定は `auto` です。

- `auto`: 推奨。`_app.asar` があれば Vencord 形式として扱い、Vencord を残す
- `direct-discord`: Vencord などの既存 loader を active chain から外し、Discord 本体に直接当てる
- `preserve-existing`: 既存 loader を残す方向の別名

Vencord を残す場合の最終形:

```text
app.asar      = 自作 mobile loader
app.vc.asar   = Vencord loader
_app.asar     = Discord 公式本体
```

起動チェーン:

```text
自作 mobile loader
 -> app.vc.asar の Vencord loader
 -> _app.asar の Discord 公式本体
```

公式 Discord のみの場合の最終形:

```text
app.asar                       = 自作 mobile loader
_app.asar                      = Discord 公式本体
app.dmi.asar                   = フォールバック用の Discord 公式本体
```

`app.dmi.asar` は、後から Vencord を入れて `_app.asar` が自作 loader に置き換わった場合でも、公式本体へ辿れるように残します。この経路では自作 loader は mobile patch を注入せず、公式本体だけを読みます。

## ローカル実行

```bash
npm install
node src/cli.mjs check --discord-path "C:\Users\you\AppData\Local\Discord\app-1.0.x\resources"
node src/cli.mjs install --discord-path "C:\Users\you\AppData\Local\Discord\app-1.0.x\resources"
```

`--discord-path` は `app.asar` が入っている `resources` ディレクトリを指定します。

自動検出を使う場合:

```bash
node src/cli.mjs check --branch stable
node src/cli.mjs check --branch canary
node src/cli.mjs check --branch ptb
node src/cli.mjs install --interactive
node src/cli.mjs install --branch stable --force-close --install-mode auto
node src/cli.mjs install --branch stable --force-close --install-mode direct-discord
```

## 安全ルール

- `app.asar` は基本的に `rename` で退避する
- `Local Storage`、`IndexedDB`、`Cookies`、`Local State` などログイン情報は触らない
- `_app.asar` がある場合、既定では Vencord 形式として扱う
- `app.asar` がすでに自作 loader の場合はインストール済みとして扱う
- `app.dmi.asar` は旧インストールの移行とフォールバックに使う
- ワンステップスクリプトは `--force-close` を渡すため、対象 Discord プロセスを閉じてから ASAR を動かす

## Vencord との関係

Vencord は `app.asar` に小さい loader を置き、元のアプリを `_app.asar` に退避して読み込みます。

このパッチャーの `auto` モードでは、Vencord の `app.asar` を `app.vc.asar` に移動してから、自作 loader を `app.asar` に置きます。これにより Vencord と mobile patch の両方を active chain に残します。

Vencord を後から入れた場合、Vencord が自作 `app.asar` を `_app.asar` に退避することがあります。その場合、自作 loader は `app.dmi.asar` をフォールバックとして読みますが、mobile patch は注入しません。

## 開発

```bash
npm install
npm test
```

設計メモは [docs/design.md](docs/design.md) を参照してください。
