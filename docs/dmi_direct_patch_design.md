# DMI Direct Patch Design

## 結論

DMI は、Discord の ASAR chain を自前で複雑に管理しない。

DMI の責任範囲は、次の1つに限定する。

```text
公式 Discord app.asar
  ↓
DMI patch 済み app.asar
```

Vencord などのサードパーティ loader との併用は、次の順番だけを正式サポートする。

```text
1. 公式 Discord
2. DMI install
3. Vencord install
```

この設計では、DMI は `app.vc.asar` や `app.dmi.asar` のような独自 chain ファイルを作らない。

---

## DMI の正式名称

DMI は次の略称として扱う。

```text
Discord Mobile Identify
```

プロジェクト名としては、次のように表記する。

```text
Discord Mobile Identify Patcher
```

略称は以下を使う。

```text
DMI Patcher
```

README などでは、初出時に次のように明記する。

```text
DMI stands for Discord Mobile Identify.
```

---

## 設計目的

この設計の目的は、DMI install / uninstall 時の状態空間を小さく保つこと。

旧設計では、次のようなファイルを複数管理していた。

```text
app.asar
_app.asar
app.dmi.asar
app.vc.asar
marker.json
```

この方式は復元性を意識したものだが、実際には状態が増えすぎる。

たとえば、次のような状態をすべて正しく扱う必要がある。

```text
official-only
mobile-only
vencord-only
mobile-then-vencord
vencord-then-mobile
partial-install
partial-uninstall
unknown-third-party-loader
broken-chain
```

これを避けるため、DMI は Discord 本体の `app.asar` を patch 済みに置き換えるだけにする。

---

## 基本方針

### DMI がやること

DMI は、公式 Discord の `app.asar` をバックアップし、patch 済みの `app.asar` に置き換える。

```text
Before:
resources/
  app.asar                 # 公式 Discord

After:
resources/
  app.asar                 # DMI patch 済み Discord
  app.dmi.backup.asar      # 元の公式 Discord
  app.dmi.marker.json      # DMI 管理情報
```

### DMI がやらないこと

DMI は、Vencord や他の third-party loader の chain を管理しない。

具体的には、次のようなことはしない。

```text
- app.vc.asar を作らない
- app.dmi.asar を作らない
- Vencord loader を退避しない
- Vencord loader の次段 ASAR を自前で選ばない
- Vencord install 済み環境に後から割り込まない
```

DMI の責任はあくまで次の変換だけ。

```text
公式 Discord → DMI patch 済み Discord
```

---

## install の挙動

`dmi install` は、現在の `resources` がクリーンな公式 Discord 状態である場合だけ実行する。

### 1. resources directory を検出する

対象は Discord の `resources` ディレクトリ。

例:

```text
Windows:
%LOCALAPPDATA%\Discord\app-*\resources
%LOCALAPPDATA%\DiscordCanary\app-*\resources
%LOCALAPPDATA%\DiscordPTB\app-*\resources

macOS:
/Applications/Discord.app/Contents/Resources
/Applications/Discord Canary.app/Contents/Resources
/Applications/Discord PTB.app/Contents/Resources
```

### 2. 現在の状態を検査する

最低限、次を確認する。

```text
resources/app.asar が存在する
resources/app.dmi.backup.asar が存在しない
resources/app.dmi.marker.json が存在しない
resources/_app.asar が存在しない
```

さらに、`app.asar` が公式 Discord 本体らしいことを確認する。

たとえば、ASAR 内部に次のような Discord 本体の特徴があるか確認する。

```text
package.json
index.js
app_bootstrap
Discord 固有の entrypoint
```

逆に、次のような特徴があれば install を拒否する。

```text
Vencord
BetterDiscord
OpenAsar
loader
patcher.js
_app.asar を参照するコード
```

ここで拒否する理由は、DMI が third-party loader の上からさらに chain を組む設計ではないため。

### 3. 公式 app.asar をバックアップする

現在の `app.asar` を、DMI のバックアップとして保存する。

```text
resources/app.asar
  ↓
resources/app.dmi.backup.asar
```

バックアップは原則として上書きしない。

`app.dmi.backup.asar` が既に存在する場合、それは DMI 管理下または壊れた途中状態の可能性があるため、install は中断する。

### 4. patch 済み app.asar を生成する

`app.dmi.backup.asar` を元に patch 済み ASAR を生成する。

```text
resources/app.dmi.backup.asar
  ↓ unpack
working directory
  ↓ inject DMI hook
patched app.asar
  ↓ replace
resources/app.asar
```

公式 `app.asar` を直接その場で破壊的に編集しない。

必ずバックアップを作ってから、作業ディレクトリで patch 済み ASAR を生成し、最後に `resources/app.asar` として配置する。

### 5. marker を作成する

`resources/app.dmi.marker.json` を作成する。

最低限の内容は次の通り。

```json
{
  "tool": "discord-mobile-identify-patcher",
  "name": "Discord Mobile Identify Patcher",
  "version": "x.y.z",
  "mode": "direct-official-patch",
  "backup": "app.dmi.backup.asar",
  "installedAt": "2026-06-04T00:00:00.000Z"
}
```

可能なら hash も保存する。

```json
{
  "originalSha256": "...",
  "patchedSha256": "..."
}
```

hash があると、uninstall 時に次を検証できる。

```text
- backup が install 時の公式 app.asar と一致するか
- 現在の app.asar が DMI patch 済み app.asar と一致するか
- DMI 以外が app.asar を変更していないか
```

---

## install 後の状態

DMI install 直後の状態はこれだけ。

```text
resources/
  app.asar                 # DMI patch 済み Discord
  app.dmi.backup.asar      # 元の公式 Discord
  app.dmi.marker.json      # DMI 管理情報
```

この状態では、Discord は DMI patch 済みの本体として起動する。

---

## Vencord との併用

Vencord と併用する場合は、必ず DMI install 後に Vencord を install する。

```text
1. 公式 Discord
2. dmi install
3. Vencord install
```

Vencord install 後の想定状態は次の通り。

```text
resources/
  app.asar                 # Vencord loader
  _app.asar                # DMI patch 済み Discord
  app.dmi.backup.asar      # 元の公式 Discord
  app.dmi.marker.json      # DMI 管理情報
```

この状態で、DMI は Vencord loader を管理しない。

Vencord から見ると、`_app.asar` は「元の Discord 本体」に見える。

実際には、その `_app.asar` が DMI patch 済み Discord である、という構造になる。

```text
Vencord loader
  ↓
DMI patch 済み Discord
```

DMI はこの chain に後から介入しない。

---

## Vencord install 済み環境への DMI install

Vencord が既に入っている状態では、DMI install は拒否する。

たとえば次のような状態。

```text
resources/
  app.asar                 # Vencord loader
  _app.asar                # 公式 Discord
```

この状態で DMI を後から差し込もうとすると、DMI が Vencord の chain を理解して書き換える必要がある。

それを許すと、また `app.vc.asar` や `app.dmi.asar` のような中間ファイルが必要になり、状態空間が複雑になる。

そのため、正式にはサポートしない。

表示するメッセージは次のような方針にする。

```text
Vencord or another third-party loader appears to be installed.
DMI only supports installation on a clean official Discord app.asar.
Please uninstall Vencord first, then run DMI install, then install Vencord again.
```

日本語では次のようにする。

```text
Vencord または他の third-party loader が既に入っている可能性があります。
DMI はクリーンな公式 Discord app.asar に対してのみ install できます。
先に Vencord を uninstall し、その後 DMI install → Vencord install の順で実行してください。
```

---

## uninstall の挙動

DMI uninstall は、DMI が直接管理している状態だけを元に戻す。

### uninstall 可能な状態

基本的には次の状態だけを直接 uninstall 可能にする。

```text
resources/
  app.asar                 # DMI patch 済み Discord
  app.dmi.backup.asar      # 元の公式 Discord
  app.dmi.marker.json      # DMI 管理情報
```

この場合、処理は単純。

```text
resources/app.dmi.backup.asar
  ↓ restore
resources/app.asar

resources/app.dmi.marker.json を削除
```

uninstall 後は次の状態になる。

```text
resources/
  app.asar                 # 公式 Discord
```

必要であれば、`app.dmi.backup.asar` は削除する。

### Vencord 併用状態での uninstall

Vencord install 後は、次のような状態になる。

```text
resources/
  app.asar                 # Vencord loader
  _app.asar                # DMI patch 済み Discord
  app.dmi.backup.asar      # 元の公式 Discord
  app.dmi.marker.json      # DMI 管理情報
```

この状態で DMI uninstall を直接行うと、Vencord の chain を壊す可能性がある。

そのため、DMI uninstall は原則として拒否する。

表示するメッセージは次の方針。

```text
DMI appears to be installed under Vencord.
To uninstall DMI, uninstall Vencord first, then run DMI uninstall.
```

日本語では次のようにする。

```text
DMI は Vencord 配下で使われている可能性があります。
DMI を uninstall するには、先に Vencord を uninstall してから DMI uninstall を実行してください。
```

Vencord uninstall 後、状態が次のように戻れば、DMI uninstall できる。

```text
resources/
  app.asar                 # DMI patch 済み Discord
  app.dmi.backup.asar      # 元の公式 Discord
  app.dmi.marker.json      # DMI 管理情報
```

---

## check / doctor の挙動

`dmi check` または `dmi doctor` は、現在の状態を判定して表示する。

### official-only

```text
resources/
  app.asar                 # 公式 Discord
```

表示例。

```text
State: official-only
DMI is not installed.
You can run dmi install.
```

### dmi-only

```text
resources/
  app.asar                 # DMI patch 済み Discord
  app.dmi.backup.asar
  app.dmi.marker.json
```

表示例。

```text
State: dmi-only
DMI is installed directly on Discord.
You can run dmi uninstall.
```

### vencord-over-dmi

```text
resources/
  app.asar                 # Vencord loader
  _app.asar                # DMI patch 済み Discord
  app.dmi.backup.asar
  app.dmi.marker.json
```

表示例。

```text
State: vencord-over-dmi
DMI appears to be installed under Vencord.
To uninstall DMI, uninstall Vencord first, then run dmi uninstall.
```

### vencord-only

```text
resources/
  app.asar                 # Vencord loader
  _app.asar                # 公式 Discord
```

表示例。

```text
State: vencord-only
DMI is not installed.
DMI cannot be installed on top of an existing Vencord chain.
Uninstall Vencord first, then run dmi install, then install Vencord again.
```

### unknown-third-party-loader

```text
resources/
  app.asar                 # unknown loader
```

表示例。

```text
State: unknown-third-party-loader
DMI cannot safely modify this Discord installation.
Please restore official Discord first.
```

### broken-or-partial

たとえば次のような状態。

```text
app.dmi.backup.asar はあるが marker がない
marker はあるが backup がない
app.asar の hash が marker と一致しない
_app.asar があるが app.asar が Vencord loader ではない
```

表示例。

```text
State: broken-or-partial
DMI found inconsistent files and will not modify this installation automatically.
Please restore Discord manually or reinstall Discord.
```

---

## 拒否条件

状態空間を小さく保つため、DMI install は次の場合に拒否する。

```text
- app.asar が存在しない
- app.asar が公式 Discord 本体に見えない
- app.asar が Vencord loader に見える
- app.asar が BetterDiscord / OpenAsar / unknown loader に見える
- _app.asar が存在する
- app.dmi.backup.asar が既に存在する
- app.dmi.marker.json が既に存在する
- 以前の install / uninstall の途中状態に見える
```

この設計では、拒否は失敗ではなく安全動作。

DMI が扱える状態を狭くすることで、誤ってユーザーの Discord 環境や Vencord 環境を壊す可能性を下げる。

---

## ファイル命名

DMI が直接作成するファイルは、原則として次の2つだけ。

```text
app.dmi.backup.asar
app.dmi.marker.json
```

使わないファイル。

```text
app.dmi.asar
app.vc.asar
```

`_app.asar` は DMI が作らない。

`_app.asar` は Vencord など、既存の third-party loader が作る可能性があるファイルとして扱う。

---

## marker の役割

`app.dmi.marker.json` は、DMI がその Discord installation を管理しているかどうかを判断するための外部 marker。

ASAR 内部に marker を入れる案もあるが、外部 marker の方が check / uninstall で扱いやすい。

推奨する marker の例。

```json
{
  "tool": "discord-mobile-identify-patcher",
  "name": "Discord Mobile Identify Patcher",
  "version": "1.0.0",
  "mode": "direct-official-patch",
  "backup": "app.dmi.backup.asar",
  "installedAt": "2026-06-04T00:00:00.000Z",
  "originalSha256": "...",
  "patchedSha256": "..."
}
```

### marker に入れるべきもの

```text
- tool name
- human-readable name
- DMI version
- install mode
- backup filename
- installedAt
- original app.asar hash
- patched app.asar hash
```

### marker に入れなくていいもの

```text
- Vencord の状態
- Vencord loader の path
- app.vc.asar などの chain 情報
- third-party loader の内部構造
```

DMI は third-party loader の管理者ではないため、その情報を marker に持たない。

---

## 失敗時の扱い

install はできるだけ atomic に近づける。

推奨手順。

```text
1. app.asar を app.dmi.backup.asar に退避
2. 一時ディレクトリで patch 済み app.asar を生成
3. 生成した app.asar の sanity check
4. resources/app.asar に配置
5. marker を作成
```

可能なら、最終配置前に一時ファイル名を使う。

```text
app.dmi.new.asar
```

最後に rename する。

```text
app.dmi.new.asar → app.asar
```

ただし、最終的な通常状態に `app.dmi.new.asar` を残さない。

途中失敗した場合、`doctor` が検出して案内する。

---

## CLI 方針

CLI は少なく保つ。

推奨コマンド。

```bash
dmi check
dmi install
dmi uninstall
dmi doctor
```

`check` と `doctor` は統合してもよい。

最低限必要なのは次の3つ。

```bash
dmi check
dmi install
dmi uninstall
```

### install

公式 Discord にだけ install する。

Vencord 済みの場合は拒否する。

### uninstall

DMI-only 状態だけ直接 uninstall する。

Vencord-over-DMI 状態では、先に Vencord uninstall を求める。

### check / doctor

状態を表示する。

DMI が変更してよい状態かどうかを明確に示す。

---

## README に書くべきユーザー向けルール

README には、次のルールを明確に書く。

```text
Vencord と併用する場合は、必ず DMI を先に install してください。

正しい順番:
1. 公式 Discord
2. DMI install
3. Vencord install

既に Vencord が入っている場合:
1. Vencord uninstall
2. DMI install
3. Vencord install
```

DMI を外す場合。

```text
Vencord を使っていない場合:
1. DMI uninstall

Vencord と併用している場合:
1. Vencord uninstall
2. DMI uninstall
3. 必要なら Vencord install
```

---

## この設計で捨てるもの

この設計では、次の柔軟性を意図的に捨てる。

```text
- Vencord install 済み環境に DMI を後から差し込む機能
- 複数 loader の chain を DMI が自動再構成する機能
- app.vc.asar / app.dmi.asar を使った独自 chain
- どの順番でも install / uninstall できる万能性
```

その代わり、次を得る。

```text
- 状態が少ない
- uninstall が単純
- 責任範囲が明確
- Vencord の内部構造に依存しにくい
- 壊れた状態を作りにくい
- ユーザーへの説明が簡単
```

---

## 最終的な設計判断

DMI は、Discord の loader chain manager ではなく、公式 Discord を DMI patch 済み Discord に変換する patcher として設計する。

最終方針は次の通り。

```text
DMI install:
  公式 app.asar を backup し、DMI patch 済み app.asar に置き換える

DMI uninstall:
  backup から公式 app.asar を復元する

Vencord 併用:
  DMI install 後に Vencord install する順番だけサポートする

Vencord 済み環境:
  DMI install は拒否する

DMI 管理ファイル:
  app.dmi.backup.asar
  app.dmi.marker.json

DMI が管理しないもの:
  app.vc.asar
  app.dmi.asar
  _app.asar
```

この方針により、DMI は最小限の状態だけを管理し、uninstall 時にクリーンな公式 Discord へ戻しやすくなる。
