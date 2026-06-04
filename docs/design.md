# 最終設計

この文書は Discord Mobile IDENTIFY Patcher の ASAR チェーン設計をまとめる。目的は、公式 Discord、自作 mobile patch、Vencord のどの順番でも破綻しにくくし、必要に応じて明示的に片方だけ外せるようにすること。

## 基本方針

- `install` は自作 patch を入れる操作に限定する。
- 既存の Vencord を見つけた場合は消さず、自作 loader の次段に残す。
- 後から Vencord が入った場合は Vencord を優先し、自作 loader は公式本体を読むだけで mobile patch を注入しない。
- 自作 patch や Vencord 層の削除は、将来的に `uninstall-self` / `uninstall-vencord-layer` のような明示コマンドで行う。
- Discord のユーザーデータ、ログイン情報、Cookie、Local Storage、IndexedDB は触らない。

## ファイル名

```text
app.asar      = 現在の先頭 loader
_app.asar     = Discord 公式本体、または Vencord が次に読む ASAR
app.vc.asar   = Vencord loader の退避先
app.dmi.asar  = 自作 patch 用の短いフォールバック ASAR
```

## 状態分類

### official-only

```text
app.asar = Discord 公式本体
```

### mobile-only

```text
app.asar     = 自作 mobile loader
_app.asar    = Discord 公式本体
app.dmi.asar = Discord 公式本体のフォールバック
```

`app.dmi.asar` は、後から Vencord を入れたときに `_app.asar` が自作 loader に置き換わるケースへの保険。

### vencord-only

```text
app.asar  = Vencord loader
_app.asar = Discord 公式本体
```

### vencord-then-mobile

```text
app.asar    = 自作 mobile loader
app.vc.asar = Vencord loader
_app.asar   = Discord 公式本体
```

起動チェーン:

```text
自作 mobile loader
 -> app.vc.asar の Vencord loader
 -> _app.asar の Discord 公式本体
```

### mobile-then-vencord

```text
app.asar     = Vencord loader
_app.asar    = 自作 mobile loader
app.dmi.asar = Discord 公式本体
```

起動チェーン:

```text
Vencord loader
 -> _app.asar の自作 loader
 -> app.dmi.asar の Discord 公式本体
```

この状態では、自作 loader は mobile patch を注入しない。後から Vencord を入れた意図を尊重し、Vencord 優先として扱う。

## 現在実装済みの install 動作

### official-only に install

```text
before:
app.asar = Discord 公式本体

after:
app.asar     = 自作 mobile loader
_app.asar    = Discord 公式本体
app.dmi.asar = Discord 公式本体のフォールバック
```

### vencord-only に install

```text
before:
app.asar  = Vencord loader
_app.asar = Discord 公式本体

after:
app.asar    = 自作 mobile loader
app.vc.asar = Vencord loader
_app.asar   = Discord 公式本体
```

### mobile-only / vencord-then-mobile に再 install

自作 loader を repair する。既存の公式本体や Vencord loader は上書きしない。

### mobile-then-vencord に install

`_app.asar` が自作 loader で、`app.dmi.asar` が存在する場合は、`vencord-then-mobile` へ正規化できる。

```text
before:
app.asar     = Vencord loader
_app.asar    = 自作 mobile loader
app.dmi.asar = Discord 公式本体

after:
app.asar    = 自作 mobile loader
app.vc.asar = Vencord loader
_app.asar   = Discord 公式本体
```

## loader の実行時動作

自作 loader は次段 ASAR を次の順で選ぶ。

1. `app.vc.asar` がある場合は Vencord loader を読む。このとき mobile patch を注入する。
2. 自作 loader 自身が `_app.asar` から起動され、`app.dmi.asar` がある場合は、それを公式本体として読む。このとき mobile patch は注入しない。
3. それ以外は `_app.asar` を公式本体として読む。このとき mobile patch を注入する。

## 将来追加する明示コマンド

全ケース対応を安全にするには、`install` に削除処理を混ぜず、明示コマンドを分ける。

### check

現在の状態を分類して表示する。

```json
{
  "state": "vencord-then-mobile",
  "activeChain": ["mobile", "vencord", "official"],
  "canInstallSelf": true,
  "canUninstallSelf": true,
  "canUninstallVencordLayer": true
}
```

### uninstall-self

自作 patch だけを外す。

```text
mobile-only:
app.asar = Discord 公式本体
```

```text
vencord-then-mobile:
app.asar  = Vencord loader
_app.asar = Discord 公式本体
```

```text
mobile-then-vencord:
app.asar  = Vencord loader
_app.asar = Discord 公式本体
```

### uninstall-vencord-layer

Vencord 層だけを外す。

```text
vencord-only:
app.asar = Discord 公式本体
```

```text
vencord-then-mobile:
app.asar  = 自作 mobile loader
_app.asar = Discord 公式本体
```

```text
mobile-then-vencord:
app.asar  = 自作 mobile loader
_app.asar = Discord 公式本体
```

## 安全ルール

- ASAR の移動は基本的に `rename` で行う。
- 既存 backup は通常 install で不用意に上書きしない。
- 公式本体のフォールバックは `app.dmi.asar` に統一する。
- `app.asar` が自作 loader かどうかは `marker.json` で判定する。
- Vencord loader は `index.js` が Vencord patcher を require する小さい ASAR として判定できる。
- Discord 起動中の ASAR 置換は避け、必要なら対象 Discord プロセスを閉じる。
- ログイン状態に関わるユーザーデータ領域は変更しない。

## 受け入れ基準

- 公式 Discord のみに install すると mobile-only になる。
- Vencord のみに install すると vencord-then-mobile になる。
- 自作 patch 後に Vencord を入れた状態でも Discord 公式本体まで到達できる。
- 自作 patch 後に Vencord を入れた状態では mobile patch を注入しない。
- `app.dmi.asar` がある環境では、Vencord 後入れ状態でも公式本体まで到達できる。
- `npm test` が通る。
