# dsh-plugin-ui-zoom

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 客户端提供界面缩放：
**Ctrl+=** 放大，**Ctrl+-** 缩小，**Ctrl+0** 恢复 100%。

[English](README.md) | 中文

![CI](https://github.com/jiangshirong/dsh-plugin-ui-zoom/actions/workflows/ci.yml/badge.svg)

## 为什么需要它

Harness 桌面版的渲染进程是沙箱化的（`sandbox: true`、`contextIsolation: true`、
`nodeIntegration: false`），而它的 preload 没有把 Electron 的 `webFrame` 缩放接口暴露给页面；
内置的插件组合里也没有任何界面缩放的快捷键绑定。结果是整个界面固定在某个比例，无法调整。

这个插件补上这个手势。它是一个**客户端半边插件**：包根是一个空的宿主行（Loader 条目需要有一个），
真正干活的是模块表加载的浏览器半边。

## 安装

### 1. 把包装到 profile 能解析到的位置

在 profile 目录里执行（`$DSH_HOME/profiles/<profile>`；桌面版是 `~/.dsh/profiles/desktop`）：

```sh
dsh plugin --profile desktop add github:jiangshirong/dsh-plugin-ui-zoom
```

`dsh plugin` 会把参数转发给 profile 里的 pnpm，所以任何 pnpm 支持的写法都可以——
git 托管地址、tarball 链接，或者开发时的本地路径：

```sh
# 开发时，从本仓库的检出目录安装
dsh plugin --profile desktop add file:/到本仓库的绝对路径/dsh-plugin-ui-zoom
```

<details>
<summary>等价的手工做法</summary>

Loader 会从 `<profile>/node_modules` 解析行对应的包，所以直接拷目录同样可行：

```sh
cd ~/.dsh/profiles/desktop
mkdir -p node_modules
cp -r /到本仓库的路径/dsh-plugin-ui-zoom node_modules/dsh-plugin-ui-zoom
```

</details>

### 2. 挂载这一行

在 profile 的 `cordis.patch.yml` 里加入：

```yaml
# 界面缩放（Ctrl+= / Ctrl+- / Ctrl+0）。
- insert:
    - id: ui-zoom
      name: dsh-plugin-ui-zoom
```

`insert` 这层包装是必须的。只写 `id` 和 `name` 的补丁行是用来**覆盖已存在**条目的；
当条目不存在时它会被静默丢弃，所以新增一行必须显式 insert。

### 3. 让它生效

**需要重启应用**才会拾取这一行，然后**重新加载界面**浏览器半边才会运行。

两步都是必需的。挂载这一行会给宿主一个全新的 Loader 条目，但它对外公布的 bundle 地址是在
模块图里编排出来的，而给一个正在运行的应用新增客户端条目，会让这张图停留在上一次的编排结果上。
已经打开的页面是在启动时读取模块图的，所以它也不会拥有这一行。

重启后插件会以一个名为 `<profile 里的包名>` 的 Loader 条目出现，重新加载界面即可从
`/plugins/<包名>/client.js` 取得它的浏览器半边。

两种失败模式值得认识：

| 现象 | 原因 |
|---|---|
| 启动时报 `1 entry did not activate` / `import failed` | 产物执行失败——见「模块表封装」一节 |
| 条目是 active 但手势没反应 | 挂载该行之后没有重新加载界面 |

恢复对话框会提供「禁用第三方插件」，那会从头重写 profile 补丁。如果用了它，上面那段 `insert` 需要重新加上。

## 使用

| 手势 | 效果 |
|---|---|
| `Ctrl` + `=` | 放大一档 |
| `Ctrl` + `Shift` + `=`（也就是 `+`） | 放大一档 |
| `Ctrl` + 小键盘 `+` | 放大一档 |
| `Ctrl` + `-` | 缩小一档 |
| `Ctrl` + 小键盘 `-` | 缩小一档 |
| `Ctrl` + `0` / 小键盘 `0` | 恢复 100% |

macOS 上主修饰键是 `Cmd` 而不是 `Ctrl`。

档位为 `50% 60% 70% 80% 90% 100% 110% 125% 150% 175% 200%`，选择会按浏览器源记住。
缩放变化时窗口底部会短暂显示当前百分比。

前三个手势同时注册为应用命令（`view.zoomIn`、`view.zoomOut`、`view.zoomReset`），
因此会出现在**设置 → 键盘快捷键**里，可以在那里改键。

## 实现

```
src/index.ts     宿主半边 —— 诊断镜像
src/client.ts    浏览器半边 —— 插件、控制器、两条输入通路
src/scale.ts     档位、夹紧、偏好持久化（不依赖 DOM）
src/gestures.ts  按键分类（不依赖 DOM）
src/document.ts  唯一写文档的模块
src/trace.ts     只写的失败痕迹（浏览器侧）
src/journal.ts   把痕迹从 localStorage 读回来（Node 侧）
scripts/build.mjs          构建两个半边，含模块表封装
scripts/verify-build.mjs   用真实门面执行构建产物
scripts/install-profile.mjs 把构建好的产物装进 profile，并让 id 与行名一致
tests/unit/                逻辑、控制器、日记读取与痕迹行为
tests/system/              真实浏览器里跑构建产物
```

同时走两条输入通路，这是有意为之：

- **快捷键注册表**（`ctx.shortcuts.register`）。这条通路让手势可被发现、可在设置里改键，
  也是产品里其他命令的接线方式。
- **捕获阶段的 `keydown` 监听**。注册表的按键校验只接受 `KeyA–Z`、`Digit0–9` 和功能键，
  小键盘的键码根本无法表达为绑定；`Ctrl+Shift+=`（`+`）也需要单独处理。监听器覆盖这两种情况。

Electron 会把注册表命中的绑定当普通输入转发给页面，所以一次物理按键可能同时出现在两条通路上。
一个 60ms 的去重窗口保证这一次按键只走一档。

缩放本身是作用于应用根元素的 `transform`，配合反向尺寸补偿，使外壳仍盖满窗口：

```css
transform-origin: 0 0;
transform: scale(S);
width:  calc(100% / S);
height: calc(100% / S);
```

用 `transform` 是为了让界面其余部分保持正确。`zoom` 声明看起来更直接，但它会**落进
`getBoundingClientRect()` 里**：用测量矩形定位的浮层，在 `position: fixed` 相对被缩放的初始包含块
解析时会**被二次缩放**。实测"锚定按钮下方"的间隙（正确值 8px）：

| 缩放 | `:root` 上的 `zoom` | 外壳上的 `transform` |
|---|---|---|
| 100% | 8 | 8 |
| 70% | −201 | 8 |
| 110% | 77 | 8 |
| 125% | 179 | 8 |
| 150% | 348 | 8 |

`transform` 不改变任何元素的实测几何，所以锚定在按钮上的菜单在任何档位都仍然落在按钮上。
`tests/system/` 在七个档位上断言这个间隙——它正是这套机制存在的理由。

反向尺寸是使用 `transform` 的代价：`transform` 不触发重排，不补偿的话外壳会保留未缩放的布局盒，
在右边和下边留下空隙。把外壳按 `100% / S` 布局再按 `S` 缩放，就恢复了包围盒，
因此它的百分比子元素仍然按真实视口分配。

### 模块表封装

第三方客户端产物必须自己复现构建管线产出的那层封装。`scripts/build.mjs` 显式写出它，
因为其中两个细节是承重的，而且光读一个已发布的 bundle 都看不出来：

1. 全局变量是 **`window.__ModuleLoader__`**。第一方 bundle 读的是 `ow.__ModuleLoader__`，
   但 `ow` 是打包器在**自己输出内部**声明的局部别名。插件没有那个作用域，
   照抄会在启动时报 `Uncaught ReferenceError: ow is not defined`——
   Harness 会报成 `1 entry did not activate` 并拒绝启动。
2. 工厂的**返回值**就是模块导出。封装里可能声明了 `module` 和 `exports`，但没有任何地方读
   `module.exports`；只给 `exports` 赋值却不返回，结果就是 `undefined`，该行永远挂载不上
   （报 `import failed`）。

`npm run build` 会在产物破坏任一不变量时失败，`tests/system/` 会在真实浏览器里用真实门面执行
构建产物，所以这层封装不会悄悄回归。

3. 封装里的 `id` 必须等于挂载它的**行名**。这个名字是构建时写死的，所以用不同的行名挂载同一份
   产物会让注册校验失败，而你能看到的只有 `import failed`。
   `scripts/install-profile.mjs` 负责把构建产物装进 profile 并把 id 改写成一致——换名安装请用它：

   ```sh
   npm run build
   node scripts/install-profile.mjs ~/.dsh/profiles/desktop @your/name
   ```

### 诊断激活失败

沙箱渲染进程对外是不透明的：它的控制台读不到，而 Harness 的崩溃报告只覆盖"应用级致命错误"。
于是**逐条目激活失败不会在任何地方留下痕迹**——这让人很难分清"插件没运行"和"插件运行了但手势没送达"。

本插件消除了这个盲点。浏览器半边把简短的标记追加进页面自身存储里的一本日记，宿主半边每秒把它
镜像到 `$DSH_HOME/ui-zoom-trace.log`：

| 标记 | 含义 |
|---|---|
| `M:module` | 产物已执行，工厂已注册 |
| `A:apply` | 宿主已挂载插件，`apply` 被调用 |
| `A:locale-failed` / `A:controller-failed` | 该步抛错，附带消息 |
| `C:restored=<档位>` | 已应用存储中的偏好 |
| `C:root=<标签>` | 被缩放的元素；外壳尚未挂载根元素时为 `<absent>` |
| `C:selftest=<值>` | 从引擎读回的实际 transform（`<none>` 表示"被接受但不生效"） |
| `C:listening` | 按键监听已安装 |
| `A:ready:<档位>` | 插件已完全挂载 |
| `K:<键码>:<修饰键>` | 有一次按键到达了文档（由独立的见证监听记录） |

日记上限 200 条，每次写入都做了失败包含，且不改变插件的任何行为。

## 开发

```sh
npm install
npm run check     # 类型检查、构建、单测、产物契约、系统测试
```

`npm run test:system` 需要一个基于 Chromium 的浏览器（Chrome、Edge 或 Chromium）。
找不到时它报告**跳过**而不是通过，因此缺浏览器绝不会伪装成绿灯。

## 已知局限

这些是"在沙箱渲染进程里做界面缩放"这件事的性质，不是多写代码能修掉的 bug：

- **缩放时文档被裁剪**（`html{overflow:hidden}`，仅在非 100% 时安装）。采用 `transform` 之后，
  文档自身的滚动尺寸不再变化，所以这只是一道防止分数缩放产生边缘滚动条的保险，而不是必需品。
  依赖文档级滚动的页面会少一点滚动；自带外壳是在自己的容器里滚动的。
- **根元素是按选择器定位的。** 插件依次尝试 `#root`、`[data-dsh-app-root]`、`body`。
  三者都不存在的组合下会缩放 `body`——这仍然正确，但也会连带缩放宿主页面挂在应用旁边的元素。
- **布局以文档像素计量，因此自行缩放的插件与测量矩形要保持一致。** `transform` 不改变任何元素的
  实测几何，锚定浮层之所以现在能用正是因为这个；剩下的细微之处是方框的**视觉**尺寸与布局尺寸
  相差一个缩放比，而这正是根元素上的反向尺寸所对齐的东西。
- **真正正确的机制是 `webFrame.setZoomLevel()`。** 那才是 Electron 的浏览器缩放，
  完全没有布局单位和测量上的副作用，但桌面版 preload 没有把它暴露给渲染进程。
  如果将来 Harness 在 `dshDesktop` 上暴露了缩放桥，本插件应改写为调用它并退役 CSS 通路。

## 许可

MIT
