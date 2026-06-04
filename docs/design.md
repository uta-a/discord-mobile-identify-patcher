# 最終設計

この文書は Discord Mobile IDENTIFY Patcher の ASAR チェーン設計をまとめる。目的は、公式 Discord、自作 mobile patch、Vencord のどの順番でも共存でき、どちらか一方をアンインストールしても残った構成が正常に動き続けるようにすること。

## 基本方針

- 自作 patch と Vencord は、可能な限り常に共存させる。
- インストール順が `Vencord -> 自作` でも `自作 -> Vencord` でも、最終的に両方の loader が公式 Discord 本体まで到達できるようにする。
- どちらか一方をアンインストールした場合は、残った loader と公式 Discord 本体をつなぎ直す。
- `install` は自作 patch を入れる/修復/正規化する操作に限定する。
- 削除は `uninstall-self` / `uninstall-vencord-layer` のような明示コマンドで行う。
- Discord のユーザーデータ、ログイン情報、Cookie、Local Storage、IndexedDB は触らない。

## ファイル名

```text
app.asar     = 現在の先頭 loader
_app.asar    = Vencord が次に読む ASAR。通常は Discord 公式本体か自作 loader
app.vc.asar  = Vencord loader の退避先
app.dmi.asar = Discord 公式本体のフォールバック
```

`app.dmi.asar` は、公式本体を `_app.asar` 以外の場所にも保持するための短い名前。特に `公式 -> 自作 -> Vencord` の順で入れた場合、Vencord が `_app.asar` を自作 loader で上書きするため、公式本体への経路として必要になる。

## 状態分類

### official-only

```text
app.asar = Discord 公式本体
```

有効なもの:

```text
Discord 公式
```

### mobile-only

```text
app.asar     = 自作 mobile loader
_app.asar    = Discord 公式本体
app.dmi.asar = Discord 公式本体のフォールバック
```

起動チェーン:

```text
自作 mobile loader
 -> _app.asar の Discord 公式本体
```

有効なもの:

```text
自作 mobile patch + Discord 公式
```

### vencord-only

```text
app.asar  = Vencord loader
_app.asar = Discord 公式本体
```

起動チェーン:

```text
Vencord loader
 -> _app.asar の Discord 公式本体
```

有効なもの:

```text
Vencord + Discord 公式
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

有効なもの:

```text
自作 mobile patch + Vencord + Discord 公式
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
 -> _app.asar の自作 mobile loader
 -> app.dmi.asar の Discord 公式本体
```

有効なもの:

```text
Vencord + 自作 mobile patch + Discord 公式
```

この状態でも自作 loader は mobile patch を注入する。後から Vencord を入れた場合でも、Vencord と自作 patch は共存させる。

## install-self の動作

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

### mobile-only に再 install

自作 loader を repair する。`_app.asar` と `app.dmi.asar` は上書きしない。

### vencord-then-mobile に再 install

自作 loader を repair する。`app.vc.asar` と `_app.asar` は上書きしない。

### mobile-then-vencord に install

この状態はすでに Vencord と自作 patch が共存しているため、そのままでも動く。必要なら正規化して `vencord-then-mobile` にできる。

正規化する場合:

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

正規化後も有効なものは同じ。

```text
自作 mobile patch + Vencord + Discord 公式
```

## loader の実行時動作

自作 loader は次段 ASAR を次の順で選ぶ。

1. `app.vc.asar` がある場合は Vencord loader を読む。このとき mobile patch を注入する。
2. 自作 loader 自身が `_app.asar` から起動され、`app.dmi.asar` がある場合は `app.dmi.asar` を Discord 公式本体として読む。このときも mobile patch を注入する。
3. それ以外は `_app.asar` を Discord 公式本体として読む。このとき mobile patch を注入する。

つまり、どの順番で入っても自作 loader が起動する限り mobile patch は有効にする。

## check

`check` は現在の状態を分類し、次のような情報を返す。

```json
{
  "state": "mobile-then-vencord",
  "activeChain": ["vencord", "mobile", "official"],
  "canInstallSelf": true,
  "canUninstallSelf": true,
  "canUninstallVencordLayer": true
}
```

状態判定は、少なくとも次を見る。

- `app.asar` が自作 loader か
- `_app.asar` が自作 loader か
- `app.asar` が Vencord loader か
- `app.vc.asar` が Vencord loader か
- `_app.asar` が Discord 公式本体か
- `app.dmi.asar` が Discord 公式本体か

## uninstall-self

自作 patch だけを外す。Vencord がある場合は Vencord を残す。

### mobile-only から uninstall-self

```text
before:
app.asar     = 自作 mobile loader
_app.asar    = Discord 公式本体
app.dmi.asar = Discord 公式本体のフォールバック

after:
app.asar     = Discord 公式本体
app.dmi.asar = 削除
```

### vencord-then-mobile から uninstall-self

```text
before:
app.asar    = 自作 mobile loader
app.vc.asar = Vencord loader
_app.asar   = Discord 公式本体

after:
app.asar  = Vencord loader
_app.asar = Discord 公式本体
app.dmi.asar = 削除
```

### mobile-then-vencord から uninstall-self

```text
before:
app.asar     = Vencord loader
_app.asar    = 自作 mobile loader
app.dmi.asar = Discord 公式本体

after:
app.asar  = Vencord loader
_app.asar = Discord 公式本体
```

## uninstall-vencord-layer

Vencord 層だけを外す。自作 patch がある場合は自作 patch を残す。

### vencord-only から uninstall-vencord-layer

```text
before:
app.asar  = Vencord loader
_app.asar = Discord 公式本体

after:
app.asar = Discord 公式本体
```

### vencord-then-mobile から uninstall-vencord-layer

```text
before:
app.asar    = 自作 mobile loader
app.vc.asar = Vencord loader
_app.asar   = Discord 公式本体

after:
app.asar  = 自作 mobile loader
_app.asar = Discord 公式本体
```

### mobile-then-vencord から uninstall-vencord-layer

```text
before:
app.asar     = Vencord loader
_app.asar    = 自作 mobile loader
app.dmi.asar = Discord 公式本体

after:
app.asar     = 自作 mobile loader
_app.asar    = Discord 公式本体
app.dmi.asar = Discord 公式本体のフォールバック
```

この場合は `_app.asar` の自作 loader を `app.asar` に戻し、`app.dmi.asar` を公式本体として残す。

## 外部 Vencord uninstall への対応

Vencord の公式 uninstaller が `mobile-then-vencord` 状態で実行された場合、Vencord は `_app.asar` を `app.asar` に戻す可能性がある。

```text
before:
app.asar     = Vencord loader
_app.asar    = 自作 mobile loader
app.dmi.asar = Discord 公式本体

after:
app.asar     = 自作 mobile loader
app.dmi.asar = Discord 公式本体
```

この状態でも自作 loader は `app.dmi.asar` を公式本体として読める必要がある。つまり `app.asar` が自作 loader で `_app.asar` がなく、`app.dmi.asar` がある場合も mobile-only の亜種として扱う。

## 安全ルール

- ASAR の移動は基本的に `rename` で行う。
- 既存 backup は通常 install で不用意に上書きしない。
- 公式本体のフォールバックは `app.dmi.asar` に統一する。
- `app.asar` や `_app.asar` が自作 loader かどうかは `marker.json` で判定する。
- Vencord loader は `index.js` が Vencord patcher を require する小さい ASAR として判定できる。
- Discord 起動中の ASAR 置換は避け、必要なら対象 Discord プロセスを閉じる。
- ログイン状態に関わるユーザーデータ領域は変更しない。

## 受け入れ基準

- 公式 Discord のみに install すると mobile-only になる。
- Vencord のみに install すると vencord-then-mobile になる。
- 自作 patch 後に Vencord を入れた状態でも Vencord と自作 patch が両方動く。
- `mobile-then-vencord` から自作 patch を外すと vencord-only になる。
- `mobile-then-vencord` から Vencord を外すと mobile-only になる。
- `vencord-then-mobile` から自作 patch を外すと vencord-only になる。
- `vencord-then-mobile` から Vencord を外すと mobile-only になる。
- `app.dmi.asar` がある環境では、Vencord 後入れ状態でも公式本体まで到達できる。
- `npm test` が通る。
