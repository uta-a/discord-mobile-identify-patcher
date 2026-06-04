# Discord Mobile Identify Patcher

DMI stands for Discord Mobile Identify.

Discord Desktop の Gateway `IDENTIFY` を Android 風の値に書き換えて、モバイル表示を狙う実験的なパッチャーです。

Discord のクライアントファイルを変更するため、Discord の規約に反する可能性や、Discord/Vencord の更新で壊れる可能性があります。インストール中は Discord を閉じてください。

## 対応範囲

- クリーンな公式 Discord の `app.asar` だけに install する
- 公式 `app.asar` を `app.dmi.backup.asar` に退避する
- DMI patch 済み `app.asar` を生成して置き換える
- `app.dmi.marker.json` に install 情報と hash を保存する
- WebSocket の Gateway `IDENTIFY` (`op: 2`) だけを書き換える

DMI Patcher は Vencord や他の third-party loader の chain を管理しません。`app.vc.asar` や `app.dmi.asar` は作りません。

## Vencord と併用する場合

Vencord と併用する場合は、必ず DMI を先に install してください。

正しい順番:

1. 公式 Discord
2. DMI install
3. Vencord install

既に Vencord が入っている場合:

1. Vencord uninstall
2. DMI install
3. Vencord install

DMI を外す場合:

1. Vencord を使っていない場合は DMI uninstall
2. Vencord と併用している場合は、先に Vencord uninstall
3. その後 DMI uninstall
4. 必要なら Vencord install

## インストール

インストーラーは検出した Discord と確認項目を表示し、上下矢印キーと Enter で選択できます。

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
curl -fsSL https://raw.githubusercontent.com/uta-a/discord-mobile-identify-patcher/main/scripts/bootstrap-macos.sh | DMI_NONINTERACTIVE=1 bash
```

Windows でプロンプトなしにする場合:

```powershell
$env:DMI_NONINTERACTIVE = "1"; powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/uta-a/discord-mobile-identify-patcher/main/scripts/bootstrap-windows.ps1 | iex"; Remove-Item Env:\DMI_NONINTERACTIVE
```

## アンインストール

Windows PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/uta-a/discord-mobile-identify-patcher/main/scripts/bootstrap-uninstall-windows.ps1 | iex"
```

macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/uta-a/discord-mobile-identify-patcher/main/scripts/bootstrap-uninstall-macos.sh | bash
```

Canary や PTB から外す場合は、インストール時と同じく `DMI_BRANCH` または引数で `canary` / `ptb` を指定します。

## ローカル実行

```bash
npm install
node src/cli.mjs check --discord-path "C:\Users\you\AppData\Local\Discord\app-1.0.x\resources"
node src/cli.mjs install --discord-path "C:\Users\you\AppData\Local\Discord\app-1.0.x\resources"
node src/cli.mjs uninstall --discord-path "C:\Users\you\AppData\Local\Discord\app-1.0.x\resources"
```

自動検出を使う場合:

```bash
node src/cli.mjs check --branch stable
node src/cli.mjs doctor --branch stable
node src/cli.mjs install --interactive
node src/cli.mjs install --branch stable --force-close
node src/cli.mjs uninstall --branch stable --force-close
```

ローカルの OS 別スクリプトを使う場合:

```bash
npm run install:mac
npm run uninstall:mac
```

```powershell
npm run install:win
npm run uninstall:win
```

## 状態判定

- `official-only`: DMI は未インストール。`install` できます。
- `dmi-only`: DMI が直接 Discord に入っています。`uninstall` できます。
- `vencord-over-dmi`: Vencord 配下に DMI がある可能性があります。先に Vencord を uninstall してください。
- `vencord-only`: DMI は未インストールですが、この状態には install できません。
- `unknown-third-party-loader`: 安全に変更できないため拒否します。
- `broken-or-partial`: DMI 管理ファイルが不整合です。手動復旧または Discord 再インストールを検討してください。

## 安全ルール

- `app.asar` が公式 Discord 本体に見える場合だけ install する
- `_app.asar` がある場合は third-party loader chain とみなし、install を拒否する
- `app.dmi.backup.asar` と `app.dmi.marker.json` が不整合なら自動変更しない
- uninstall 時は marker の hash と現在の `app.asar` / backup を照合する
- `Local Storage`、`IndexedDB`、`Cookies`、`Local State` などログイン情報は触らない

## 開発

```bash
npm install
npm test
```

設計メモは [docs/dmi_direct_patch_design.md](docs/dmi_direct_patch_design.md) を参照してください。
