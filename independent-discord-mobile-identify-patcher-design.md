# Independent Discord Mobile IDENTIFY Patcher Design

Last updated: 2026-06-04

## 目的

Vencord、BetterDiscord、Equicord などの既存 third-party patcher に依存せず、公式 Discord の Gateway `IDENTIFY` 送信前に hook を差し込み、`d.properties` を Android 風に差し替える独立 patcher を作る。

また、既に Vencord / BetterDiscord / Equicord などが入っている環境でも、それらを壊さず、既存の `app.asar` 起動 chain の前段に自作 loader を追加する。

## 非目的

- Discord の全通信から PC 情報を完全に消すこと
- Discord の renderer bundle を永続的に直接編集すること
- Vencord / BetterDiscord / Equicord の plugin API に依存すること
- Discord update 後も自動で残り続ける常駐 updater を作ること
- uninstall 機能を必須要件にすること

Discord update により `resources/app.asar` が公式状態へ戻る可能性は許容する。消えた場合は patcher を再実行する。

ただし、uninstall を作らない場合でも、二重 install 防止と backup 上書き防止は必須とする。

## 背景

Discord Gateway の初回接続では `IDENTIFY` payload が送られる。

概念的には次の形になる。

```js
{
  op: 2,
  d: {
    token: "...",
    properties: {
      os: "Windows",
      browser: "Discord Client",
      device: "",
      // other Discord desktop fields
    },
    presence: {}
  }
}
```

mobile status の判定には、少なくとも `properties.browser` が強く関係している。desktop Discord から mobile 表示を狙う場合、送信直前の `d.properties` を Android 風にする。

```js
{
  os: "Android",
  browser: "Discord Android",
  device: "Discord Android",
  browser_user_agent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
  browser_version: "125.0.0.0",
  os_version: "14"
}
```

Vencord では、Discord の renderer Webpack module を runtime patch して `GatewaySocket` / `_doIdentify()` 周辺を書き換える。今回作る patcher は Vencord に依存せず、より小さく、`WebSocket` hook を中心にして `IDENTIFY` の送信直前を書き換える。

## 基本方針

既存の `resources/app.asar` を直接改造しない。

代わりに、現在有効な `resources/app.asar` を自作 patcher 専用の backup 名へ退避し、自作 loader 入りの `app.asar` を新しく配置する。

```txt
before:
resources/
  app.asar

after:
resources/
  app.asar                         <- 自作 mobile identify loader
  app.asar.mobile-status-backup    <- 直前に存在していた app.asar
```

Vencord などが既に入っている場合も、現在の `app.asar` を「次に起動すべき既存 layer」として扱う。

```txt
before:
resources/
  app.asar      <- Vencord / BetterDiscord / Equicord などの loader
  _app.asar     <- 既存 patcher が作った backup の可能性がある

after:
resources/
  app.asar                         <- 自作 mobile identify loader
  app.asar.mobile-status-backup    <- Vencord / BetterDiscord / Equicord などの loader
  _app.asar                        <- 既存ファイル。触らない
```

`_app.asar` は Discord 公式が最初から持つファイルではなく、多くの場合 Vencord などが公式 `app.asar` を退避するために作った名前である。そのため、自作 patcher は `_app.asar` を特別扱いしない。

重要なルール:

- 常に「今ある `app.asar`」を次の layer として退避する
- `_app.asar` は読まない、動かさない、上書きしない
- 自作 backup 名は `app.asar.mobile-status-backup` のように自分専用にする
- 二重 install 時に backup を上書きしない

## 全体アーキテクチャ

```txt
Discord executable
  |
  v
resources/app.asar
  |
  |  自作 loader
  |  - Electron 起動前後の最小 hook
  |  - BrowserWindow の webPreferences.preload に自作 preload を追加
  |  - 退避済み app.asar.mobile-status-backup の main を起動
  v
resources/app.asar.mobile-status-backup
  |
  |  既存 layer
  |  - 公式 Discord
  |  - Vencord
  |  - BetterDiscord
  |  - Equicord
  v
Discord renderer
  |
  |  自作 preload
  |  - WebSocket constructor / send を early hook
  |  - Gateway IDENTIFY op:2 の d.properties を Android 風に置換
  v
Gateway WebSocket
```

## 新規プロジェクト構成案

```txt
discord-mobile-identify-patcher/
  package.json
  README.md
  docs/
    design.md
  src/
    cli.mjs
    config.mjs
    detect/
      discordInstallations.mjs
      platformPaths.mjs
    install/
      install.mjs
      guard.mjs
      buildLoaderAsar.mjs
    loader/
      package.json
      index.js
      preload.js
      marker.json
    hook/
      mobileIdentifyHook.js
    utils/
      asarPaths.mjs
      fileOps.mjs
      hash.mjs
      log.mjs
  test/
    fixtures/
      official-app-asar/
      vencord-like-app-asar/
    install.test.mjs
    guard.test.mjs
    mobileIdentifyHook.test.mjs
```

### `src/cli.mjs`

CLI entrypoint。

想定コマンド:

```bash
node src/cli.mjs install
node src/cli.mjs install --branch stable
node src/cli.mjs install --discord-path "C:\Users\...\Discord\app-1.0.x\resources"
node src/cli.mjs check
```

`uninstall` は初期要件に含めない。ただし、将来追加しやすいように backup 名と marker は固定しておく。

### `src/detect/platformPaths.mjs`

OS ごとの Discord resources path 候補を返す。

Windows 例:

```txt
%LOCALAPPDATA%\Discord\app-*\resources
%LOCALAPPDATA%\DiscordCanary\app-*\resources
%LOCALAPPDATA%\DiscordPTB\app-*\resources
```

macOS 例:

```txt
/Applications/Discord.app/Contents/Resources
/Applications/Discord Canary.app/Contents/Resources
/Applications/Discord PTB.app/Contents/Resources
```

Linux 例:

```txt
/usr/share/discord/resources
/usr/lib/discord/resources
~/.local/share/Discord/resources
```

初期実装では Windows と macOS を優先し、Linux は後続でもよい。

### `src/install/guard.mjs`

install 前の安全確認を担当する。

必須チェック:

- `resources/app.asar` が存在する
- `resources/app.asar` が自作 loader かどうか判定する
- `resources/app.asar.mobile-status-backup` が既に存在するか判定する
- backup 上書きが発生しないことを保証する
- Discord が起動中でないことを確認する、または warning を出して中断する

判定結果の例:

```js
{
  canInstall: true,
  alreadyInstalled: false,
  backupExists: false,
  reason: null
}
```

### `src/install/install.mjs`

実際の install を行う。

手順:

1. resources path を確定する
2. guard を実行する
3. 現在の `app.asar` の hash を記録する
4. 現在の `app.asar` を `app.asar.mobile-status-backup` に rename する
5. 自作 loader asar を `app.asar` として配置する
6. 配置後に marker を確認する

重要: 退避は copy ではなく rename を基本にする。copy 後 delete は途中失敗時に壊れやすい。Windows で rename が失敗する場合は Discord が起動中の可能性が高いので中断する。

### `src/install/buildLoaderAsar.mjs`

`src/loader/` を asar に固める。

使用候補:

- `@electron/asar`

生成する loader asar には、最低限次を含める。

```txt
package.json
index.js
preload.js
marker.json
```

`marker.json` 例:

```json
{
  "name": "discord-mobile-identify-patcher",
  "kind": "mobile-identify-loader",
  "version": "0.1.0"
}
```

## Loader 設計

### loader の責務

`resources/app.asar` として起動される最小 layer。

責務:

- 自作 preload を Discord renderer に差し込む
- 退避済み `app.asar.mobile-status-backup` の本来の main を起動する
- Vencord / BetterDiscord / Equicord など既存 layer の処理を邪魔しない

責務ではないこと:

- Discord renderer bundle を直接書き換えること
- Vencord plugin を読み込むこと
- Discord update を止めること

### loader/package.json

```json
{
  "name": "discord-mobile-identify-loader",
  "main": "index.js"
}
```

### loader/index.js の処理

概念コード:

```js
const path = require("path");
const Module = require("module");
const electron = require("electron");

const resourcesDir = process.resourcesPath;
const nextAsar = path.join(resourcesDir, "app.asar.mobile-status-backup");
const ownPreload = path.join(__dirname, "preload.js");

patchBrowserWindowPreload(electron, ownPreload);
loadNextApp(nextAsar);
```

### BrowserWindow preload hook

Discord の renderer に自作 preload を入れるため、`BrowserWindow` 作成時の `webPreferences.preload` を chain する。

既存 preload がある場合、上書きしてはいけない。自作 preload から既存 preload を require する、または combined preload を生成して両方を実行する。

推奨:

```txt
BrowserWindow options
  webPreferences.preload = generated-combined-preload.js

generated-combined-preload.js
  1. 自作 mobile hook を実行
  2. 元 preload があれば require(originalPreload)
```

理由:

Vencord / BetterDiscord / Discord 公式も preload を使う可能性がある。単純に `webPreferences.preload` を自作ファイルで上書きすると、既存 patcher を壊す。

### loadNextApp

退避済み asar の `package.json` を読み、`main` を解決して require する。

概念コード:

```js
function loadNextApp(nextAsar) {
  const packageJsonPath = path.join(nextAsar, "package.json");
  const packageJson = require(packageJsonPath);
  const mainFile = packageJson.main || "index.js";
  require(path.join(nextAsar, mainFile));
}
```

注意:

Node / Electron は asar 内パスを通常のディレクトリのように `require()` できる。そのため `path.join(nextAsar, "package.json")` のような参照が可能。

## Hook 設計

### 基本方針

renderer の JavaScript 環境で、できるだけ早く `WebSocket.prototype.send` を hook する。

目的は Gateway `IDENTIFY` の `op: 2` だけを対象にすること。

対象外:

- heartbeat `op: 1`
- resume `op: 6`
- presence update
- REST API
- analytics
- voice gateway

### mobileIdentifyHook.js

概念コード:

```js
(() => {
  const marker = Symbol.for("MobileIdentifyPatcher.websocketSend");
  if (globalThis[marker]) return;
  globalThis[marker] = true;

  const WebSocketCtor = globalThis.WebSocket;
  if (typeof WebSocketCtor !== "function") return;

  const proto = WebSocketCtor.prototype;
  const originalSend = proto.send;

  proto.send = function patchedSend(data) {
    if (typeof data === "string" && data.includes('"op":2')) {
      try {
        const payload = JSON.parse(data);

        if (payload && payload.op === 2 && payload.d && payload.d.properties) {
          payload.d = {
            ...payload.d,
            properties: createAndroidProperties(payload.d.properties)
          };

          return originalSend.call(this, JSON.stringify(payload));
        }
      } catch {
        // Keep original behavior when payload is not JSON.
      }
    }

    return originalSend.call(this, data);
  };

  function createAndroidProperties(original) {
    return {
      ...original,
      os: "Android",
      browser: "Discord Android",
      device: "Discord Android",
      browser_user_agent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
      browser_version: "125.0.0.0",
      os_version: "14"
    };
  }
})();
```

初期実装では、元 `properties` を完全に捨てず、spread してから mobile 関連 field を上書きする方式を推奨する。

理由:

Discord desktop が追加で期待する field を失うと、Gateway 側や client 側の挙動が壊れる可能性があるため。

PC 情報を減らしたい場合は、第2段階で whitelist 方式を検証する。

## 初回 IDENTIFY に間に合わせる設計

課題:

Discord は renderer 起動直後に Gateway WebSocket を作る可能性がある。自作 preload の実行が遅いと、初回 `IDENTIFY` が desktop properties のまま送られる。

対策:

1. `BrowserWindow` の `webPreferences.preload` へ自作 preload を必ず入れる
2. 自作 hook は preload の top-level で即実行する
3. 必要なら `WebSocket` constructor も hook し、Gateway fast connect を一度だけ遅延させる

fast connect block の考え方:

```js
const NativeWebSocket = globalThis.WebSocket;
let blocked = false;

globalThis.WebSocket = new Proxy(NativeWebSocket, {
  construct(target, args, newTarget) {
    const url = args[0];

    if (
      !blocked &&
      typeof url === "string" &&
      url.includes("gateway.discord.gg")
    ) {
      blocked = true;
      args[0] = "ws://127.0.0.1:9";
    }

    return Reflect.construct(target, args, newTarget);
  }
});
```

ただし、この方式は初回接続を意図的に失敗させるため、Discord 側の retry に依存する。まずは preload を最速で入れる方式を優先し、初回に間に合わない環境だけ fast connect block を有効化する設定にする。

設定例:

```json
{
  "fastConnectBlock": false
}
```

## 二重 install 防止設計

uninstall を作らない場合でも、二重 install 防止は必須。

### 問題例

防止しないと次のように元 app が失われる。

```txt
1回目:
resources/
  app.asar                         <- 自作 loader
  app.asar.mobile-status-backup    <- 元 app.asar

2回目:
resources/
  app.asar                         <- 新しい自作 loader
  app.asar.mobile-status-backup    <- 1回目の自作 loader で上書き
```

この場合、元の Discord / Vencord / BetterDiscord layer が消える。

### 判定方法

`resources/app.asar` が自作 loader かどうかを marker で判定する。

loader asar 内に次を含める。

```txt
marker.json
```

install 前に `app.asar/marker.json` を読み、次の条件を満たすなら already installed と判定する。

```json
{
  "kind": "mobile-identify-loader"
}
```

### install guard の状態遷移

```txt
case A:
  app.asar is our loader
  -> already installed
  -> backup しない
  -> 成功扱い、または loader 再配置のみ

case B:
  app.asar is not our loader
  app.asar.mobile-status-backup does not exist
  -> install 可能

case C:
  app.asar is not our loader
  app.asar.mobile-status-backup exists
  -> 中断
  -> backup 上書き禁止

case D:
  app.asar does not exist
  -> 中断
```

### guard 疑似コード

```js
function evaluateInstallState(resourcesDir) {
  const appAsar = path.join(resourcesDir, "app.asar");
  const backupAsar = path.join(resourcesDir, "app.asar.mobile-status-backup");

  if (!exists(appAsar)) {
    return { action: "abort", reason: "app.asar not found" };
  }

  if (isOurLoader(appAsar)) {
    return { action: "already-installed" };
  }

  if (exists(backupAsar)) {
    return {
      action: "abort",
      reason: "backup already exists and app.asar is not our loader"
    };
  }

  return { action: "install" };
}
```

## Vencord / BetterDiscord / Equicord との共存

共存の原則:

- 現在の `app.asar` を next layer として扱う
- 既存 backup 名を推測しない
- 既存 preload を上書きしない
- 既存 loader の main を require して処理を続行する

### Vencord が入っている場合

```txt
self loader
  -> app.asar.mobile-status-backup
     -> Vencord loader
        -> _app.asar
           -> official Discord
```

### BetterDiscord が入っている場合

```txt
self loader
  -> app.asar.mobile-status-backup
     -> BetterDiscord modified app
        -> official Discord
```

BetterDiscord の実際の構造はバージョンにより変わる可能性があるため、「BetterDiscord 固有ファイルを探して起動する」方式にはしない。

### Equicord が入っている場合

Equicord が Vencord と同系統の inject 構造を取る場合、Vencord と同じ考え方で chain する。

## セキュリティ・安全性

この patcher はユーザーの Discord インストール先にある `app.asar` を置き換える。失敗すると Discord が起動しなくなる可能性がある。

安全策:

- backup 上書き禁止
- 二重 install 防止
- install 前に hash を記録
- rename / write は同一 resources directory 内で行う
- 途中失敗時は可能なら rollback する
- Discord 起動中は install しない
- 管理者権限が必要な場所では明示的にエラーにする
- network から任意コードを取得して即実行しない

注意:

Discord の client 改変は Discord の利用規約に抵触する可能性がある。配布時は自己責任であること、アカウント制限リスクがあることを明記する。

## テスト方針

### Unit test

対象:

- `evaluateInstallState`
- `isOurLoader`
- `createAndroidProperties`
- `patchWebSocketSend`

重要ケース:

- `op: 2` だけが書き換わる
- `op: 1` heartbeat は変えない
- JSON でない data はそのまま送る
- `ArrayBuffer` / `Blob` はそのまま送る
- 既存 properties の未知 field が残る
- marker 付き app.asar は already installed 扱いになる
- backup が既にある場合は中断する

### Fixture test

疑似 `resources/` を作る。

```txt
fixtures/
  official/
    app.asar
  vencord-like/
    app.asar
    _app.asar
```

検証:

- install 後に `app.asar` が自作 loader になる
- 元 `app.asar` が `app.asar.mobile-status-backup` に退避される
- `_app.asar` は変更されない
- 2回目 install で backup が上書きされない

### Manual test

1. Discord を終了する
2. patcher を実行する
3. Discord を起動する
4. DevTools または hook log で `IDENTIFY.properties.browser` を確認する
5. `Discord Android` になっていることを確認する
6. Vencord 入り環境で Vencord が消えていないことを確認する

## 実装順序

1. 新規 Node.js project を作成する
2. `evaluateInstallState` の test を先に書く
3. install guard を実装する
4. loader asar build を実装する
5. fixture resources に対する install test を書く
6. loader の `loadNextApp` を実装する
7. BrowserWindow preload chain を実装する
8. `mobileIdentifyHook` の unit test を書く
9. `WebSocket.prototype.send` hook を実装する
10. Windows の実 Discord resources path で手動検証する
11. macOS の Discord update 後の再 install 手順を README に書く

## 受け入れ基準

- 公式 Discord の `resources/app.asar` を自作 loader に置き換えられる
- 直前の `app.asar` が `app.asar.mobile-status-backup` に退避される
- `_app.asar` など既存 backup ファイルを変更しない
- 既に自作 loader が入っている場合、backup を上書きしない
- backup が存在し、かつ `app.asar` が自作 loader でない場合は中断する
- Vencord 入り環境で Vencord の起動 chain を維持できる
- Gateway `IDENTIFY` の `d.properties.browser` が `Discord Android` に変わる
- `IDENTIFY` 以外の WebSocket payload は変更しない

## 未解決事項

- BetterDiscord の最新 inject 構造との実機互換性
- macOS の code signing / quarantine / update 後挙動
- Discord Canary / PTB の branch path detection
- `contextIsolation` / `sandbox` 設定下で preload hook が常に効くか
- `WebSocket.prototype.send` hook だけで初回 IDENTIFY に必ず間に合うか
- fast connect block を default 有効にするか

## 推奨 MVP

最初の MVP は Windows Stable Discord のみを対象にする。

MVP 範囲:

- resources path を手動指定できる
- `app.asar` を backup して自作 loader を配置する
- marker による二重 install 防止
- BrowserWindow preload chain
- `WebSocket.prototype.send` による `op: 2` 書き換え
- fixture test

MVP ではやらない:

- 自動 update 常駐
- uninstall
- GUI
- BetterDiscord / Equicord 固有検出
- whitelist properties mode

