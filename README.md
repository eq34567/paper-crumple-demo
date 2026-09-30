# Paper Crumple — Houdini VAT × Three.js

An interactive demo of crumpled paper balls: click one to unfold it into a card, drag to pick it up, flick to throw it. The crumpling animation is a Vellum simulation baked in Houdini as **VAT (Vertex Animation Textures)**, decoded and played back in Three.js, with cannon-es handling the physics.

## 🙏 署名 / Credits

| | 原版 | 本分支（肥皂泡版） |
|---|---|---|
| **作者** | **item-develop**（DE長澤） | [eq34567](https://github.com/eq34567)（二次开发） |
| **仓库** | <https://github.com/item-develop/paper-crumple-demo> | <https://github.com/eq34567/paper-crumple-demo> |
| **在线 demo** | <https://paper-crumple-demo.pages.dev/> | <https://eq34567.github.io/paper-crumple-demo/> |
| **配套教程** | Codrops 文章 *Building an Interactive Crumpled Paper Effect with Houdini VAT and Three.js* | — |

纸团揉捏动画（Houdini VAT）、物理与交互框架的功劳属于原作者。本分支新增：**肥皂泡玩法**——右键纸团裹入气泡漂浮，右键托住气泡拖动 + 滚轮前后推拉，两泡相碰合并，戳破时膜面从一点破开、水珠飞溅、雾化消散，泡内纸团有惯性/碰撞/撞壁物理，全程 WebAudio 合成音效。气泡膜为纯 ShaderMaterial（菲涅尔 + 薄膜干涉彩虹），并修复了原版的边缘发黑问题。

## Running it

**Windows：** 双击 `启动.bat` 即可（自动检测 python / node 并打开浏览器，关掉黑色窗口即停止）。

No install and no build step — everything here is plain static files. Dependencies (three.js and cannon-es) are resolved from a CDN via the import map in `index.html`.

Serve this folder with any static file server and open it in a browser:

```sh
npx serve .
# or
python3 -m http.server 8000
```

(Opening `index.html` directly from the file system won't work — browsers block ES module and asset loading over `file://`.)

## What's inside

```
index.html      Entry point (import map + markup)
src/            The demo source, as-is
  main-vat.js   Scene, physics, interaction, state machine
  paper-vat.js  VAT loader: FBX + EXR decoding, smooth normals
  paper.js      Paper-face design composed with Canvas 2D
vat/            Houdini VAT export (FBX mesh + EXR position texture)
data/           Thumbnail SVGs for the fictional paper designs
```

## License

[MIT](./LICENSE)
