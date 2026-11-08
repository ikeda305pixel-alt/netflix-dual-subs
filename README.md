# Netflix 日英デュアル字幕 & 広告ブロック拡張機能 (`netflix-dual-subs`)

Netflixの動画視聴時に **日本語字幕と英語字幕を上下2段で同時表示（デュアル字幕）** し、さらに **広告再生時の自動ミュート・倍速化・スキップ、プロモーション枠の非表示、イントロ／あらすじの自動スキップ** を行う Chrome / Edge 拡張機能（Manifest V3）です。

---

## 主な機能

1. **日英デュアル字幕表示 (Dual Subtitles)**
   - Netflix の字幕ストリーム（TTML / DFXP XML、WebVTT、JSON TimedText）をインターセプトし、日本語（`ja`）と英語（`en`）の両トラックを自動で取得・同期表示します。
   - **カスタマイズ可能**: 上下の言語順序入れ替え、メイン／サブ文字サイズ、背景の不透明度、字幕タイミングのミリ秒補正（`-5000ms` 〜 `+5000ms`）に対応。
2. **広告ブロック & 広告再生時の快適化 (Ad-Break Controller)**
   - **Declarative Net Request (`rules/ad_promo_rules.json`)**: 広告トラッキング・テレメトリ通信（`ichnaea.netflix.com/cl2/ad*`, `doubleclick.net` 等）をネットワーク層でブロック。
   - **広告再生時の自動制御**: 広告枠（`[data-uia="ads-info-container"]` 等）を検知すると、自動で音声をミュート＆再生速度を倍速（デフォルト `4.0x`）に引き上げ、スキップボタンが出現した場合は即座に自動クリックします。広告終了後は元の音量・再生速度に自動復帰します。
   - **プロモーション・一時停止広告の非表示**: ビルボード広告や一時停止時のプロモオーバーレイを自動で非表示化します。
3. **イントロ・あらすじの自動スキップ**
   - 「イントロをスキップ」「前回のあらすじをスキップ」「次のエピソードへ（任意）」を自動クリックします。

---

## ディレクトリ構成

```text
netflix-dual-subs/
├── manifest.json               # Chrome Extension Manifest V3 設定
├── package.json                # テスト実行用スクリプト設定
├── rules/
│   └── ad_promo_rules.json     # Declarative Net Request 広告通信ブロックルール
├── src/
│   ├── subtitle-parser.js      # TTML/DFXP XML・WebVTT・JSON 字幕パーサー＆日英同期エンジン
│   ├── ad-blocker.js           # 広告検知・自動ミュート・倍速化・プロモ非表示・イントロスキップ制御
│   ├── injected-interceptor.js # Netflix プレーヤー API / 字幕通信インターセプター
│   ├── content.js              # コンテンツスクリプト本体・オーバーレイ描画・ショートカット制御
│   ├── content.css             # デュアル字幕オーバーレイ & 広告ステータスバッジのスタイル
│   ├── popup.html              # 拡張機能ポップアップ UI
│   ├── popup.css               # ポップアップ用スタイル
│   └── popup.js                # 設定保存 & リアルタイム統計表示ロジック
└── tests/
    ├── subtitle-parser.test.js # 字幕パーサー・同期ロジックの単体テスト
    └── ad-blocker.test.js      # 広告制御・スキップロジックの単体テスト
```

---

## ローカル環境への引き継ぎ手順

### 1. リポジトリのクローンと作業ブランチのチェックアウト

```bash
git clone https://github.com/ikeda305pixel-alt/netflix-dual-subs.git
cd netflix-dual-subs

# 作業ブランチへ切り替え
git checkout feat/dual-subs-and-adblock
```

### 2. テストの実行

Node.js（v18以降）がインストールされていれば、外部パッケージのインストール不要で標準テストランナーを実行できます：

```bash
npm test
```

### 3. Chrome / Edge への拡張機能の読み込み手順

1. Google Chrome（または Microsoft Edge）を開き、アドレスバーに `chrome://extensions/` と入力して移動します。
2. 右上の **「デベロッパー モード (Developer mode)」** を **ON** にします。
3. 左上の **「パッケージ化されていない拡張機能を読み込む (Load unpacked)」** をクリックします。
4. クローンした `netflix-dual-subs` フォルダ（`manifest.json` があるディレクトリ）を選択します。
5. Netflix (`https://www.netflix.com/`) で動画を再生すると、自動的に日英デュアル字幕と広告ブロック機能が有効になります。

---

## キーボードショートカット（動画再生画面）

| キー | 動作 |
| :--- | :--- |
| `Alt + D` | 日英デュアル字幕の ON / OFF 切り替え |
| `Alt + S` | 日本語・英語の上下表示順序を入れ替え |
| `[` | 字幕タイミングを `-250ms` 早める |
| `]` | 字幕タイミングを `+250ms` 遅らせる |
