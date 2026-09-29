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

插件会作为一个新的 Loader 条目出现。**必须重新加载界面**，浏览器半边才会运行：
页面是带着宿主渲染进 index 的模块图启动的，所以要开一个新页面或按 `F5`。

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
src/index.ts     宿主半边 —— 一个空的 Cordis 行
src/client.ts    浏览器半边 —— 插件、控制器、两条输入通路
src/scale.ts     档位、夹紧、偏好持久化（不依赖 DOM）
src/gestures.ts  按键分类（不依赖 DOM）
src/document.ts  唯一写文档的模块
scripts/build.mjs        构建两个半边，含模块表封装
scripts/verify-build.mjs 用真实门面执行构建产物
tests/unit/              逻辑与控制器行为
tests/system/            真实浏览器里跑构建产物
```

同时走两条输入通路，这是有意为之：

- **快捷键注册表**（`ctx.shortcuts.register`）。这条通路让手势可被发现、可在设置里改键，
  也是产品里其他命令的接线方式。
- **捕获阶段的 `keydown` 监听**。注册表的按键校验只接受 `KeyA–Z`、`Digit0–9` 和功能键，
  小键盘的键码根本无法表达为绑定；`Ctrl+Shift+=`（`+`）也需要单独处理。监听器覆盖这两种情况。

Electron 会把注册表命中的绑定当普通输入转发给页面，所以一次物理按键可能同时出现在两条通路上。
一个 60ms 的去重窗口保证这一次按键只走一档。

缩放本身就是在根元素上写一条行内 `zoom` 声明。现代引擎里 `zoom` 缩放的是 `width`、`height`、
`font-size` 的**实测值**，因此嵌套的百分比布局会重新排版，各档位下外壳仍然盖满视口。
用样式表规则同样正确，但会把效果耦合到"样式表已加载"——而这恰恰是本插件绝不能有的失败模式。

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

## 开发

```sh
npm install
npm run check     # 类型检查、构建、单测、产物契约、系统测试
```

`npm run test:system` 需要一个基于 Chromium 的浏览器（Chrome、Edge 或 Chromium）。
找不到时它报告**跳过**而不是通过，因此缺浏览器绝不会伪装成绿灯。

## 已知局限

这些是"在沙箱渲染进程里做界面缩放"这件事的性质，不是多写代码能修掉的 bug：

- **`getBoundingClientRect()` 返回缩放后的坐标。** 任何先测量元素、再按文档像素定位的布局代码，
  在非 100% 时会读到缩放值。目前没观察到自带外壳出问题，但做指针驱动几何的插件应当除以缩放比。
- **缩放时文档被裁剪**（`html{overflow:hidden}`，仅在非 100% 时安装）。不装的话，
  缩放后的坐标空间会多出一条滚动条；装了的话，依赖文档级滚动的页面会少一点滚动。
  自带外壳是在自己的容器里滚动的。
- **`vw`/`vh` 单位也会被缩放**，对缩放后的坐标空间来说这是正确行为，也是外壳始终贴合窗口的原因。
- **真正正确的机制是 `webFrame.setZoomLevel()`。** 那才是 Electron 的浏览器缩放，
  没有布局单位和测量上的副作用，但桌面版 preload 没有把它暴露给渲染进程。
  如果将来 Harness 在 `dshDesktop` 上暴露了缩放桥，本插件应改写为调用它并退役 CSS 通路。

## 许可

MIT
