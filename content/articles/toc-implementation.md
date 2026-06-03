---
slug: toc-implementation
title: 实现一个 TOC 的追踪功能
date: 2026-06-03
tags: [React, TOC, IntersectionObserver, Next.js, 前端]
readTime: 15 min
status: published
---

给文章加一个目录（TOC）很常见——展示标题列表、点击跳转到对应章节。但要让目录「活」起来——自动高亮当前阅读位置、点击平滑跳转、跳转时不和自动追踪打架、侧边栏跟随阅读进度滚动——才是真正需要设计的地方。

## 直觉方案：监听 scroll 事件

最容易想到的写法是这样：

```ts
// 不推荐
window.addEventListener("scroll", () => {
  for (const item of items) {
    const el = document.getElementById(item.id)
    const rect = el.getBoundingClientRect()
    if (rect.top >= 0 && rect.top < window.innerHeight) {
      setActiveId(item.id)
      break
    }
  }
})
```

思路很简单：每次 scroll 触发时，遍历所有标题，找到第一个在视口内的作为当前章节。

这个方案有两个问题。第一，scroll 事件跟渲染帧不同步——用户快速滚动时回调可能一帧触发多次，或者完全错过某一帧。你需要节流，但节流就引入了延迟。第二，每次回调都要重新查询 DOM、计算每个标题的 `getBoundingClientRect`，标题越多开销越大。

浏览器的 `IntersectionObserver` 同时解决了这两个问题：它是异步的，在渲染帧的空隙执行；它直接告诉你哪个元素与视口交叉，不需要你手动计算位置。

## 三个核心问题

TOC 接收的数据很简单——`TocItem[]`，每个 item 只有三个字段：

```ts
interface TocItem {
  id: string    // 标题的 DOM id
  text: string  // 显示文本
  level: number // 1 或 2，控制缩进
}
```

标题是怎么从 markdown 里提取的、slug 是怎么生成的、代码块里的 `#` 是怎么排除的——这些不是 TOC 的职责。

真正有趣的问题都在这条数据边界之后：

1. **怎么知道读者正读到哪？**——用 IntersectionObserver 追踪标题与视口的交叉状态
2. **怎么处理「点击跳转」和「自动追踪」的冲突？**——跳转时锁定 Observer，滚动结束后再解锁重新同步
3. **怎么让侧边栏跟着阅读进度滚动？**——activeId 变化时，检查对应链接是否在可视区域边缘，按需调整滚动位置

下面逐一展开。

## 1. 确定当前章节

### IntersectionObserver 是怎么工作的

`IntersectionObserver` 的核心思想是：你告诉它要观察哪些元素，它在元素与视口（或指定容器）的交叉状态发生变化时回调你。

```ts
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      // entry.isIntersecting — 元素是否在视口内
      // entry.target — 被观察的 DOM 元素
    }
  },
  { rootMargin: "-40px 0px -75% 0px" }
)

// 注册所有标题
for (const item of items) {
  const el = document.getElementById(item.id)
  if (el) observer.observe(el)
}
```

每个标题元素在进入或离开视口时，Observer 会回调你。你不需要手动算 `getBoundingClientRect`，浏览器帮你做了。

### rootMargin：不是「可见」，而是「正在读」

默认情况下，Observer 在元素任意部分进入视口时就判定 `isIntersecting: true`。但这太宽了——标题刚出现在屏幕底部时读者还没读到它，TOC 不应该急着高亮。

`rootMargin` 允许你「缩小」判定区域。它的语法和 CSS margin 一样：

```
rootMargin: "-40px 0px -75% 0px"
```

- `-40px`（top）：向下压缩 40px，留出页面顶部的固定 header 的空间
- `-75%`（bottom）：向上压缩视口高度的 75%，意味着判定区域只有视口顶部 25%

效果是：标题必须进入视口**顶部 25% 的区域**才被认定为「正在读」。标题在屏幕底部时不算。当标题滚过顶部 25% 的线，它退出判定区域，下一个标题接替成为 active。

```
┌─────────────────────────┐
│      固定 header         │  ← -40px
├─────────────────────────┤
│                         │
│     判定区域（顶部25%）    │  ← 标题只有进入这里才算 active
│                         │
├─────────────────────────┤
│                         │
│     视口剩余 75%          │  ← 标题在这里不算 active
│                         │
└─────────────────────────┘
```

### 为什么 intersecting 必须是 useRef 而不是 useState

Observer 回调里，维护了一个 `Set<string>` 来记录当前所有相交的标题：

```ts
const intersectingRef = useRef(new Set<string>())
```

这个 Set 必须是 `useRef`，不能是 `useState`。

Observer 的回调可能在一次滚动内触发多次——多个标题同时越过判定线时，每个标题产生一个 entry，回调分别处理。如果每次回调都 `setState` 更新 Set，组件会被反复渲染，而中间态的 Set 对 UI 没有意义。

用 ref 的意思是：Observer 只负责「收集数据」——默默地往 Set 里加或删——然后检查是否需要更新 `activeId`。只有当 activeId 确实变了，才触发一次 `setActiveId`。这避免了不必要的渲染。

### 怎么从 Set 里选出 activeId

Observer 回调的核心逻辑：

```ts
const observer = new IntersectionObserver(
  (entries) => {
    // 1. 更新 Set：进入区域的加入，离开区域的删除
    for (const entry of entries) {
      if (entry.isIntersecting) {
        intersectingRef.current.add(entry.target.id)
      } else {
        intersectingRef.current.delete(entry.target.id)
      }
    }

    // 2. 如果处于锁定状态，不更新（后面会讲为什么）
    if (lockedRef.current) return

    // 3. 按 items 的顺序遍历，取第一个还在 Set 里的标题
    for (const item of itemsRef.current) {
      if (intersectingRef.current.has(item.id)) {
        setActiveId(item.id)
        break
      }
    }
  },
  { rootMargin }
)
```

遍历 items 的顺序是从前往后——保证如果有多个标题同时在判定区域内，高亮的是位置更靠前的、读者正在读的那个。

代码里用 `itemsRef.current` 而不是直接读取 `items`，原因和 `intersectingRef` 类似：Observer 在 `useEffect` 里创建一次，回调闭包捕获的是当时的 `items`。如果后续标题列表变化了（比如动态加载了更多章节），回调拿到的仍然是旧值。存一份 ref，每次渲染刷新 `itemsRef.current`，确保 Observer 回调读取的始终是最新的标题列表。

于是第一个问题就解决了：Observer 异步追踪标题交叉状态，Set 收集数据但避免频繁渲染，按顺序取第一个相交标题作为 active。

## 2. 处理点击跳转和自动追踪的冲突

第一个问题解决后，你会立刻遇到第二个问题：用户点击 TOC 里的某个章节，页面开始平滑滚动——但滚到一半，`IntersectionObserver` 检测到中间某个标题进入了判定区域，把 `activeId` 改成了那个中间标题。TOC 的高亮于是跳到了半路的标题上，和目标不一致。

这就是「点击跳转」和「自动追踪」的冲突。

### 加一把锁

解法很简单：点击跳转时，锁住 Observer，让它暂时停止更新 `activeId`。等滚动到达目标位置，再解锁。

```ts
const lockedRef = useRef(false)

const navigateTo = (id: string) => {
  // 1. 上锁
  lockedRef.current = true

  // 2. 立即更新 activeId——让 UI 瞬间响应，不等滚动完成
  setActiveId(id)

  // 3. 执行滚动
  const el = document.getElementById(id)
  const top = el.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET
  window.scrollTo({ top, behavior: "smooth" })
  history.replaceState(null, "", `#${id}`)

  // 4. 等滚动结束后解锁并重新同步
  onScrollEnd(() => {
    lockedRef.current = false
    // 重新检查当前实际可见的标题
    for (const item of itemsRef.current) {
      if (intersectingRef.current.has(item.id)) {
        setActiveId(item.id)
        break
      }
    }
  })
}
```

流程是：**lock → setActiveId → scrollTo → 等滚动结束 → unlock → 重新同步**。

这里有几个设计决策值得讲：

**为什么先 setActiveId 再 scrollTo？** 如果反过来——先滚动再更新状态——用户点击后 TOC 高亮不会立刻变化，要等滚动动画跑完才跳。先更新状态让点击反馈是即时的。

**为什么 unlock 之后要重新同步？** `smooth` 滚动的终点可能和预期有微小偏差（比如页面高度在滚动过程中发生了变化）。解锁后重新查询 `intersectingRef`，确保 `activeId` 和实际的视口状态一致。

**为什么用 `history.replaceState` 而不是 `pushState`？** 每点一个 TOC 项就往浏览器历史里推一条记录，用户看完文章想点「后退」回首页，得按十几次。`replaceState` 只更新 URL hash 不新增历史记录，读者可以用浏览器的后退键真正后退。

## 3. 等待滚动结束

Observer 的 lock 在**滚动完全停止**之后才能解除。但怎么知道滚动结束了？

### 优先用 scrollend，不行就 fallback

浏览器近年新增了 `scrollend` 事件，语义就是「滚动动画和惯性都结束了」。但兼容性还不完整：

```ts
function onScrollEnd(callback: () => void) {
  // 优先：原生 scrollend
  if ("onscrollend" in window) {
    window.addEventListener("scrollend", callback, { once: true })
    return () => window.removeEventListener("scrollend", callback)
  }

  // Fallback：监听 scroll + 100ms debounce
  let timer: ReturnType<typeof setTimeout>
  const onScroll = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      window.removeEventListener("scroll", onScroll)
      callback()
    }, 100)
  }
  window.addEventListener("scroll", onScroll)
  return () => {
    clearTimeout(timer)
    window.removeEventListener("scroll", onScroll)
  }
}
```

Fallback 的逻辑是：每次 scroll 事件触发时重置一个 100ms 的计时器。当用户停止滚动 100ms 后（不管是手指离开触摸板还是鼠标滚轮停下），判定为滚动结束。

这个 polyfill 不完美——100ms 是经验值，极端情况下可能偏早或偏晚。但足够覆盖绝大多数场景，而且支持 `scrollend` 的浏览器会走原生路径，不存在这个问题。

## 4. 侧边栏跟随

最后一个问题是桌面端侧边栏——读者正常滚动页面时，TOC 的 active 项一直在变。如果 active 项跑到了侧边栏可视区域外面，读者看不到当前章节在目录里的位置。

所以需要在 `activeId` 变化时检查：对应的链接在侧边栏容器里是否可见。如果贴近边缘，就滚动侧边栏让它可见。

```ts
useEffect(() => {
  if (!activeId || !containerRef.current) return

  // 用 CSS.escape 安全构造选择器
  const link = containerRef.current.querySelector(
    `a[href="#${CSS.escape(activeId)}"]`
  )
  if (!link) return

  const c = containerRef.current
  const cTop = c.getBoundingClientRect().top
  const lTop = link.getBoundingClientRect().top
  const lBottom = lTop + link.offsetHeight
  const EDGE = 8

  // 只在链接贴近容器边缘时才滚动
  if (lTop < cTop + EDGE || lBottom > cTop + c.clientHeight - EDGE) {
    const linkTop = lTop - cTop + c.scrollTop
    const target = lTop < cTop + EDGE
      ? linkTop - EDGE  // 链接在顶部被遮挡——往上滚
      : linkTop + link.offsetHeight + EDGE - c.clientHeight  // 在底部——往下滚
    c.scrollTo({ top: target, behavior: "smooth" })
  }
}, [activeId])
```

这里有三个设计点：

**为什么用 `CSS.escape`？** 标题文本可能包含冒号、括号等特殊字符，直接拼进选择器会失效。`CSS.escape("hello:world")` 变成 `"hello\\:world"`，保证选择器合法。

**为什么只在边缘才滚动？** 如果每次 `activeId` 变化都强制把链接滚到容器中央，读者手动翻看侧边栏后面章节的行为会被打断——他们刚往下翻一点，active 变了，滚动位置被重置了。只在链接超出可视区域（8px 阈值）时才调整，读者手动浏览的行为不受干扰。

**为什么用 `getBoundingClientRect` 而非 `offsetTop`？** `offsetTop` 是相对于 offsetParent 的，当容器内部有额外元素时计算复杂。`getBoundingClientRect` 返回视口坐标，两个坐标相减就直接得到相对偏移，公式更简单、更稳定。

---

## 总结

TOC 追踪的四个问题，各自对应一种解法：

| 问题 | 方案 | 关键设计 |
|------|------|----------|
| 确定当前章节 | IntersectionObserver | rootMargin 缩小判定区域；Set 收集数据但用 ref 避免频繁渲染 |
| 跳转冲突 | lock 机制 | lock → setActiveId → scrollTo → 等滚动结束 → unlock 重新同步 |
| 滚动结束 | scrollend + debounce fallback | 原生优先，100ms debounce 兜底 |
| 侧边栏跟随 | 按需滚动 | 只在链接贴近容器边缘时调整，尊重读者手动浏览 |

四个问题串起来就是 TOC 追踪的完整闭环：知道读者在哪 → 点击跳转时不冲突 → 等滚动真正结束 → 侧边栏始终可看到当前位置。
