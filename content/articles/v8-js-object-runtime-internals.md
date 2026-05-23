---
slug: v8-js-object-runtime-internals
title: V8 JavaScript 对象运行时内存机制解析
date: 2026-05-07
tags: [V8, JavaScript, 内存, 运行时]
readTime: 20 min
status: published
---

## 0. 引言：从四种创建语法到同一套内存机制

在 JavaScript 里，创建一个对象至少有四种常见写法：

```js
const a = { name: "a" };                     // 对象字面量
const b = new Object(); b.name = "b";        // new Object
const c = new User();                        // new 构造函数
const d = Object.create(User.prototype);     // Object.create
```

语法层面各有差异，但 V8 底层的内存表示逻辑是统一的：**把对象拆成两半——一半描述"这个对象有哪些属性"，一半存放"这些属性的真实数据"**。

拆分的理由很直接：JavaScript 对象可以运行时随意增删属性，如果每次访问都走哈希表查找，速度和 Python 字典没区别。V8 要的是 C 结构体级别的访问速度，这就必须维护一份"布局定义"，让属性访问变成固定的偏移量读写。

因此 V8 的设计是：

- **`Map`**（早期文献称 Hidden Class）：运行时生成的布局定义，记录这个对象有哪些属性、每个属性在内存中的偏移量是多少、原型链指向哪里
- **`JSObject`**：纯粹的数据容器，按 `Map` 的指示在内联区域或外挂数组中存放真实数据值

同一份 `Map` 可以被成千上万个对象共享。当你访问 `obj.name` 时，V8 不是去哈希表里查字符串，而是先读 `obj` 的 `Map` 指针，从 `Map` 中得知 `"name"` 在偏移量 `+0x18` 处，然后直接去那个内存地址取值。这才是 V8 高性能的根基。

---

# 一、对象的内存布局：Map 与 JSObject

## 1.1 结构总览：描述与数据的分离

V8 把每个 JavaScript 对象在底层拆成两个独立的 C++ 结构体：

```
        Map（元数据）
   ┌─────────────────────┐
   │ instance_size       │  这个对象在堆上占多少字节
   │ DescriptorArray*    │  属性清单：每个属性的名字、在 JSObject 中的偏移量、类型特征
   │ Object* prototype   │  原型链指针：找不到属性时该去哪个对象继续找
   │ TransitionArray*    │  过渡边数组：添加新属性时该迁移到哪个 Map
   │ ...                 │
   └─────────────────────┘
            ▲
            │ 每个 JSObject 头部都有一个 Map* 指针指向这里
            │ 相同属性集合的对象共享同一个 Map
            │
   ┌─────────────────────┐
   │ Map* map            │  ──────→ 指向上面的 Map
   │ FixedArray* props   │  ──────→ 外挂数组：超出内联区域的字符串属性存这里
   │ FixedArray* elems   │  ──────→ 外挂数组：obj[0]、obj[1] 等数字索引属性存这里
   │ [内联数据区]         │          name 指针、age 整数等直接内联在此
   │                     │
   └─────────────────────┘
        JSObject（数据）
```

**每个字段的作用：**

- **`instance_size`**：`JSObject` 在堆上需要分配多少字节，包括头部指针区和内联数据区
- **`DescriptorArray`**：一个有序数组，存储 `"name" → offset +0x18`、`"age" → offset +0x20` 这样的映射。V8 根据它把字符串属性名翻译成内存偏移量
- **`Object* prototype`**：原型链的 `next` 指针。在自身找不到属性时，沿着它跳到原型对象继续查找
- **`TransitionArray`**：存储从当前 Map 出发、添加某个属性后应该迁移到哪个新 Map。这是 V8 复用 Map 的核心数据结构
- **`Map* map`**：`JSObject` 头部的第一个指针，指向描述自身的 Map
- **`FixedArray* props`**：当字符串属性数量超出内联区域容量时，多余的数据被搬入这个外挂数组。访问时需要"先查 Map 找索引，再读数组"
- **`FixedArray* elems`**：专门存放数字索引属性。数字天然自带数学偏移，可以直接计算地址，无需查 Map
- **`[内联数据区]`**：紧跟在 `JSObject` 头部之后的连续内存。少量属性直接内联在这里，按固定偏移访问，速度最快

同一份 `Map` 可以被成千上万个对象共享。`p1 = { name: "张三", age: 25 }` 和 `p2 = { name: "李四", age: 30 }` 的数据值不同，但属性名和偏移量完全相同，因此共享同一个 Map。

**核心问题：当你访问 `obj.name` 时，V8 如何根据属性名找到内存中的真实数据？**

完整的查找链路是：

```
1. JS 代码: obj.name
             │
             ▼
2. V8 拿到 JSObject* obj，解引用 obj->map 找到 Map
             │
             ▼
3. 在 Map 的 DescriptorArray 中搜索字符串 key "name"
   DescriptorArray 是一个有序数组，每个条目记录：
   { key: "name", offset: +0x18, attributes: ... }
             │
             ▼
4. 拿到偏移量 +0x18，直接去 JSObject 内联数据区的 +0x18 处读取值
```

这里还有两个关键细节需要讲清楚。

**第一个细节：DescriptorArray 中怎么搜索 `"name"`？**

DescriptorArray 本质上是一个有序数组，按属性添加的先后顺序排列。每个属性占若干槽位，记录 `Key`（属性名字符串的指针）、`Details`（偏移量、类型特征等）、`Value`（如果是常量属性）。V8 首次访问时，需要在这个数组中按 key 匹配查找——少量属性时线性扫描，大量属性时可能走二分查找。

**对比是怎么做的？** DescriptorArray 中存的 `Key` 不是字符串的文本内容，而是指向堆中字符串对象的指针。V8 对比时走两步：

1. **指针比较（快速路径）**：由于 V8 会对属性名字符串做 **interning（驻留）**，相同内容的字符串通常共享同一个堆对象。因此多数情况下，直接比较两个指针是否相等就能判定是同一个 key。
2. **逐字符比较（慢速路径）**：如果指针不同（比如属性名是动态拼接出来的），才会回退到逐字符对比——先比长度，再比每个字符是否一致。

这也是为什么 V8 极力推荐用对象字面量或构造函数预先声明属性：这些属性名在解析阶段就会被 intern，后续属性访问时 DescriptorArray 的 key 对比几乎总是走指针比较的快速路径。

但绝大多数情况下你根本不会走到这一步。V8 的 **Inline Cache（内联缓存）** 会在第一次查找成功后，直接把 `"Map 地址 + 属性名" → 偏移量` 的映射缓存到访问点。后续再访问同一个对象的同一个属性时，引擎只需要比较 Map 指针是否匹配，匹配就直接用缓存的偏移量取值，连 DescriptorArray 都不需要碰。

**第二个细节：数据什么时候进内联区，什么时候进外挂数组？**

V8 在创建对象时会预留一定数量的**内联属性槽位**（in-object properties）。比如构造函数创建的对象，V8 通常会根据构造函数里 `this.xxx` 的赋值数量预分配几个槽位。当内联槽位用完后，再添加的新属性就会被搬到 `JSObject` 的 `properties` 外挂数组里。

怎么区分？DescriptorArray 中的每个属性条目都带有一个 `PropertyDetails` 结构，里面用字段标记了该属性是**内联（in-object）**还是**外挂（out-of-object）**：

- 内联属性：偏移量是相对于 `JSObject` 起始地址的正偏移，比如 `+0x18`
- 外挂属性：存的是 `properties` FixedArray 的数组索引，比如 `properties[0]`

V8 读取时先查 `PropertyDetails` 中的位置标记：如果是内联，直接去 `JSObject + offset` 读；如果是外挂，先去 `JSObject->properties` 拿到 FixedArray，再按索引读。

## 1.2 Map：运行时布局定义

`Map` 在 V8 源码里就是对象的"运行时 `struct` 定义"。它的 C++ 概念模型如下：

```cpp
struct Map {
    int instance_size;            // 这个对象占多少字节
    DescriptorArray* descriptors; // 属性清单：名字、偏移量、类型特征
    Object* prototype;            // 原型链指针（下一章细讲）
    TransitionArray* transitions; // 过渡边数组（见下文）
    // ...
};
```

**`DescriptorArray`** 是 `Map` 的核心。它精确记录：

- `"name"` 在 `JSObject` 内联数据区的偏移量是 `+0x18`
- `"age"` 在偏移量是 `+0x20`
- 每个属性的可枚举性、可配置性等特征

`Map` 本身**不存任何数据值**，只存"路由信息"——告诉你去 `JSObject` 的哪个偏移量找数据。

### Transition Tree：属性演化的有向树

V8 内部用一棵 **Transition Tree**（过渡树）来管理对象属性的演化。每个节点是一个 `Map`，每条有向边代表"添加某个属性"：

**阶段 1：空对象，对应 Map0**

```js
const obj = {};   // Map0: {}
```

**阶段 2：添加 name，创建 Map1**

```js
obj.name = "张三";   // Map1: {name}
// Map0 注册 "name" → Map1 的过渡边
```

**阶段 3：添加 age，创建 Map2**

```js
obj.age = 25;   // Map2: {name, age}
// Map1 注册 "age" → Map2 的过渡边
```

**阶段 4：添加 gender，创建 Map3**

```js
obj.gender = "male";   // Map3: {name, age, gender}
// Map2 注册 "gender" → Map3 的过渡边
```

**相同添加顺序的对象复用同一个 Map**

```js
const p1 = { name: "张三", age: 25 };                    // 复用 Map2
const p2 = { name: "李四", age: 30 };                    // 复用 Map2（同一个 Map）
const p3 = { name: "王五", age: 20, gender: "male" };    // 复用 Map3
// %HaveSameMap(p1, p2) === true
```

- `p1 = { name: "张三", age: 25 }` 创建时，V8 从根出发，沿 `"name" → "age"` 路径走到 `Map{name,age}`
- `p2 = { name: "李四", age: 30 }` 创建时，**复用同一分支上的同一个节点**
- 关键特征：**相同的属性添加序列共享路径上的 Map 节点**

注意，这和字典树（Trie）有相似之处——都是前缀共享的树形结构——但两者不等同。Trie 用于字符串检索，边代表字符；Transition Tree 用于追踪对象属性的演化历史，边代表"添加某个属性"。V8 源码里它的正式数据结构是 `TransitionArray`：一个存储"边"的数组，每条边记录属性名和指向的新 Map。

> 你可以在 Node.js 中验证这个机制。开启 `--allow-natives-syntax` 后，`%HaveSameMap(p1, p2)` 会返回 `true`，说明相同形状的对象确实共享同一个 Map：
>
> ```js
> const p1 = { name: "张三", age: 25 };
> const p2 = { name: "李四", age: 30 };
> // console.log(%HaveSameMap(p1, p2));  // true
> ```

## 1.4 动态添加属性时 Map 如何改变

当你执行 `p1.gender = "male"` 时，V8 会：

1. 检查当前 `Map{name,age}` 的 `TransitionArray` 中有没有 `"gender"` 这条出边
2. 如果有，沿着这条边迁移到 `Map{name,age,gender}`
3. 如果没有，新建一个 `Map{name,age,gender}` 节点，并在 `Map{name,age}` 的 `TransitionArray` 中注册 `"gender" → 新节点` 这条边
4. 将 `p1` 的 `Map` 指针指向新节点，数据写入 `JSObject` 对应的偏移位置

**修改前：p1 和 p2 共享同一个 Map**

```js
const p1 = { name: "张三", age: 25 };   // p1 → Map{name,age}
const p2 = { name: "李四", age: 30 };   // p2 → Map{name,age}（同一个 Map）
// %HaveSameMap(p1, p2) === true
```

**执行 `p1.gender = "male"`**

```js
p1.gender = "male";
```

**修改后：p1 迁移到新 Map，p2 保持不动**

```js
// p1 → Map{name,age,gender}（新建或复用 TransitionArray 中已有的边）
// p2 → Map{name,age}（不变）
// %HaveSameMap(p1, p2) === false
```

**继续添加属性**

```js
// Map 节点本身是不可变的，对象通过换指针来改变形状
// 如果后续 p1.city = "北京"，V8 会在 Map{name,age,gender} 的
// TransitionArray 中查找 "city" 边，依此类推
```

注意 `p2` **不会**跟着变。只有被修改的那个对象迁移到新 Map，其他同形状对象继续留在原地。这是 Transition 机制的关键：**Map 节点是不可变的，对象通过换指针来改变形状**。

如果 `p1` 后续继续添加 `"city"`，V8 就在 `Map{name,age,gender}` 的 `TransitionArray` 中查找 `"city"` 边，依此类推。Transition Tree 随着运行时的对象演变而生长。

> 验证 Map 迁移：给 `p` 动态添加属性后，它的 Map 会改变，而 `q` 仍停留在原来的 Map：
>
> ```js
> const p = { name: "张三", age: 25 };
> p.gender = "male";  // p 的 Map 迁移到 Map{name,age,gender}
>
> const q = { name: "李四", age: 30 };
> // q 仍停留在 Map{name,age}
> // %HaveSameMap(p, q) 此时为 false
> ```

## 1.5 JSObject：数据的容器

讲完 `Map` 这个"布局定义"，再来看真正存放数据的 `JSObject`：

```cpp
struct JSObject {
    Map* map;                 // 指向布局定义（Map）
    FixedArray* properties;   // 外挂存储：超出内联区域的字符串属性
    FixedArray* elements;     // 外挂存储：数字索引属性
    // ... 紧接着是内联数据区（in-object properties）
};
```

- **`map`**：指向该对象的 `Map`。这是对象访问任意属性的第一步——先解引用拿到布局定义
- **`properties`**：一个 `FixedArray` 指针。当字符串属性太多，塞不进内联区域时，V8 会把多余的数据放到这个外挂数组里
- **`elements`**：另一个 `FixedArray` 指针。专门存放 `obj[0]`、`obj[1]` 这类数字索引属性，直接按数学偏移访问，无需查 `Map`
- **内联数据区**：紧跟在 `JSObject` 头部之后的连续内存。少量属性直接内联在这里，和 C 结构体字段一样按固定偏移访问

`FixedArray` 是 V8 中最基础的变长数组容器：

```cpp
struct FixedArray {
    int length;           // 数组长度
    Object* data[];       // 变长数组，存储实际的值或指针
};
```

**真实值到底存在哪里？**

| 属性类型 | 存储位置 | 访问方式 |
|----------|----------|----------|
| 少量字符串属性 | `JSObject` 内联数据区 | 固定偏移量，直接寻址 |
| 大量字符串属性 | `FixedArray* properties` | 先查 Map 找索引，再读数组，间接寻址 |
| 数字索引属性 | `FixedArray* elements` | 数学偏移，直接寻址 |

举个例子：

```js
const p1 = { name: "张三", age: 25 };
const p2 = { name: "李四", age: 30 };
```

`p1` 和 `p2` 的 `Map` 相同，但 `name` 指针和 `age` 整数分别内联在各自 `JSObject` 的内联数据区中。两份数据、同一份布局定义。

## 1.6 降级：从 Shape 到 Dictionary

如果你在循环里疯狂动态添加属性，Transition 树会无限膨胀吗？

不会。V8 有一个阈值：当对象的属性数量过多（通常几十个以上），或者属性的添加/删除模式过于混乱时，引擎会**放弃 Map 机制**，把对象退化成 **Dictionary Mode**（哈希表模式）。此时属性不再走固定的偏移量，而是通过字符串哈希来查找，性能大幅下降。

> **最佳实践**：在构造函数或对象字面量中一次性声明所有属性，保持 Shape 稳定，让 V8 持续走内联缓存（Inline Cache）的高速路径。

**本章钩子**：Map 不仅描述了对象的形状和属性偏移，它的内部还藏着一个 `prototype` 指针。这个指针不参与对象的尺寸计算，不参与属性路由——它只负责回答一个问题："如果我在自己身上找不到某个属性，该去哪个对象上找？"下一章，我们解剖这根指针。

---

# 二、原型链的物理根基：`prototype` 与 `__proto__`

## 2.1 命名灾难

`prototype` 和 `__proto__` 是 JS 语言设计史上最严重的命名事故之一。它们在 V8 底层是完全不同的两种物理实体，位于完全不同的内存区域。

## 2.2 物理隔离：数据区 vs 元数据区

从 C/C++ 的内存视角看，它们一个是**数据区里的普通变量**，一个是**元数据区里的链表指针**：

### `prototype`：函数对象数据区里的一个普通属性

`User` 是一个函数，但函数在 V8 里也是堆对象（`JSFunction`）。`JSFunction` 继承自 `JSObject`，所以它也有 `map` 指针和 `properties` 数组。`User.prototype` 本质上就是 `User` 这个 `JSObject` 的 `properties` 数组中的某一项，类型是 `Object*`：

```cpp
// user_fn 是 JSFunction* 类型，继承自 JSObject
JSObject* user_fn = ...;

// 从 user_fn 的 properties 数组中，按字符串 key "prototype" 查找值
// 返回的是一个 Object* 指针，指向堆上的某个 JSObject
Object* template_obj = GetProperty(user_fn, "prototype");
```

在内存中，它和其他普通属性（比如如果你给函数设置了 `User.version = 1`）平起平坐，没有任何特殊之处。

### `__proto__`：实例元数据区里的链表指针

`u` 是实例对象（`JSObject`）。它的 `__proto__` 不是存在 `u` 的 `properties` 数组里，而是存在描述 `u` 形状的 `Map` 结构体内部：

```cpp
struct Map {
    int instance_size;
    DescriptorArray* descriptors;
    Object* prototype;     // ← 这就是 __proto__ 的物理实体
    TransitionArray* transitions;
    // ...
};
```

`Map::prototype` 的类型也是 `Object*`，但它的语义完全不同：**它是原型链查找时的 `next` 指针**。只要你是堆上的对象，你的 `Map` 里就绝对有这根指针，用来在找不到属性时跳到"爹"那里继续找。

### 一句话总结

| 概念 | C++ 类型 | 所在结构 | 内存区域 | 语义 |
|------|----------|----------|----------|------|
| `prototype` | `Object*` | `JSFunction.properties[]` | 数据区 | 普通属性值，碰巧存了模板地址 |
| `__proto__` | `Object*` | `Map.prototype` | 元数据区 | 链表 `next` 指针，负责原型链查找 |

## 2.3 JS 层面的 `new`

`let u = new User()` 在语义上等价于：

```js
const u = {};
u.__proto__ = User.prototype;
User.call(u, /* args */);
```

步骤 2 的本质是：把**数据区里的一个普通属性值**（`User.prototype`），复制到**元数据区里的链表指针**（`u.__proto__` / `u->map->prototype`）中。

## 2.4 C++ 层面的连线

翻译成 V8 的物理操作：

```cpp
// 1. 创建空对象 u，此时 u->map 指向空对象的 Map
JSObject* u = AllocateJSObject();

// 2. 去读 User 函数（JSFunction 继承 JSObject）的 "prototype" 属性
//    这是从 user_fn->properties 数组中按 key 查找，返回 Object*
Object* template_ptr = GetProperty(user_fn, "prototype");

// 3. 【核心连线】把 template_ptr 写入 u 的 Map 的 prototype 字段
//    注意：不是写入 u 的属性表，而是写入 u 的元数据图纸
u->map->prototype = template_ptr;
```

- `User.prototype` 只是 `user_fn` 的 `properties` 数组中的一个**普通属性值**
- `u.__proto__` 在底层不是属性，而是 **`u` 的 `Map` 结构体里的一个实体指针**

## 2.5 残酷真相：构造函数不在原型链上

> ⚠️ **常见误区**：顺着 `u.__proto__` 找，你找到的是 `User.prototype` 这个**模板对象**，**永远找不到** `User` 函数本身。

构造函数在实例生命周期里只扮演三个短暂角色：

1. **内存初始化器**：跑一遍 `this.name = name`，填完数据就走
2. **图纸保管员**：通过 `User.prototype` 保留公共模板的物理地址
3. **静态方法容器**：自身 `properties` 存放与实例无关的静态方法

**本章钩子**：现在你知道对象之间靠 `Map::prototype` 这根单向链表指针建立父子关系。问题是：当调用 `u.toString()` 时，V8 如何沿着这根线一步一步找？下一章追踪这次查找的完整路径。

---

# 三、属性查找的之字形链路

## 3.1 编译期定死 vs 运行期委托

C++ 的继承在编译期通过虚函数表（vtable）定死，调用时直接偏移跳转。JS 拒绝这种打包方式，继承是纯运行期的**堆内存指针委托**。调用 `u.toString()` 时，V8 启动的是一次**单向链表遍历**。

## 3.2 之字形跳跃

`__proto__` 不存在于 `JSObject` 实例上，而藏在它的 `Map` 里。因此查找路径呈之字形：

1. 查 `u` 自身属性 → 没有
2. 解引用找到 `u` 的 `Map`
3. 读 `Map->prototype` 指针
4. 跳到 `User.prototype`，重复步骤 1
5. 再跳到 `Object.prototype`，找到 `toString`

**每次跳跃都要先找到对象的 `Map`，再从 `Map` 读出 `prototype` 指针**，所以是"实例 → Map → 原型 → Map → 原型"的之字形。

## 3.3 经典原型链拓扑

**构造函数与实例创建**

```js
function User(name) { this.name = name; }
User.prototype.sayHi = function() { return "hi"; };

const u = new User("张三");
```

**第 1 层：实例自身属性**

```js
u.name;   // "张三"（自身属性，直接命中）
```

**第 2 层：`u.__proto__` → `User.prototype`**

```js
u.__proto__ === User.prototype;   // true
u.sayHi();                        // "hi"
```

**第 3 层：`User.prototype.__proto__` → `Object.prototype`**

```js
User.prototype.__proto__ === Object.prototype;   // true
u.toString();                                    // "[object Object]"
```

**第 4 层：`Object.prototype.__proto__` → `null`**

```js
Object.prototype.__proto__ === null;   // true
u.notExist;                            // undefined
```

**构造函数不在原型链上**

```js
u.__proto__ === User;   // false
```

> 📌 **Oddball**：V8 对 `null`、`undefined`、`true`、`false` 等特殊值的内部统称，是轻量对象而非完整 `JSObject`。

## 3.4 函数对象的原型绑定

`User` 本身也是堆对象（`JSFunction`）。V8 在创建它时，会把其 `Map` 的 `prototype` 指针硬编码绑定到 `Function.prototype`。这就是所有函数天然拥有 `call`/`apply` 执行能力的底层原因。

> 在 Node.js 中运行以下代码，可以验证原型链的查找顺序和构造函数不在链上的结论：
>
> ```js
> function User(name) {
>     this.name = name;
> }
> User.prototype.sayHi = function() { return "hi"; };
>
> const u = new User("张三");
>
> console.log(u.name);       // 自身属性 → "张三"
> console.log(u.sayHi());    // User.prototype → "hi"
> console.log(u.toString()); // Object.prototype → "[object Object]"
> console.log(u.notExist);   // 整条链找不到 → undefined
>
> // 验证构造函数不在原型链上
> console.log(u.__proto__ === User.prototype);  // true
> console.log(u.__proto__ === User);            // false
> ```

**本章钩子**：对象结构、原型连接、查找链路，都是静态布局。只有当函数被调用时，这些结构才被激活。下一章进入运行时：局部变量放哪里？闭包怎么访问外部变量？`this` 什么时候被塞进去？

---

# 四、执行与闭包：栈帧、堆内存与 `this`

## 4.1 函数对象的内部结构

```cpp
struct JSFunction {
    Map* map;
    Context* context;    // ← 词法作用域的物理载体（出厂焊死）
    SharedFunctionInfo* shared;
};
```

`context` 指针不参与属性查找和原型链跳跃，只负责指向"老家"——定义该函数的外层环境。

## 4.2 执行上下文 = 栈帧

每次函数调用，CPU 在栈上开辟一块空间存放局部变量和返回地址。函数 `return` 后栈帧销毁，局部变量失效。这是**动态的、短暂的**。

## 4.3 词法作用域 = 静态指针

V8 在编译期根据代码嵌套结构，为每个 `JSFunction` 的 `context` 指针赋值。这是**静态的、出厂焊死的**。无论函数被传递到何处调用，`context` 永远指向书写时的外层作用域。

## 4.4 闭包：逃逸变量进堆

V8 编译阶段进行**逃逸分析（Escape Analysis）**：判断局部变量是否被内部函数引用（逃逸到外部）。

若变量 `a` 被捕获：

1. `a` 不再放栈上，而是在堆中 `malloc` 出 `Context` 数组
2. `a` 的值存入 `Context`
3. 内部函数的 `context` 指针指向该堆内存块

只要内部函数的引用还活着，堆里的 `Context` 就无法被 GC。这是闭包导致内存泄漏的物理根源。

## 4.5 `this`：动态传入的隐藏参数

| 指针 | 决定什么 | 何时确定 | 由什么决定 |
|------|----------|----------|----------|
| `context` | 去哪找普通变量 | 编译期 | 代码**定义位置**（静态） |
| `this` | 当前操作的目标对象 | 运行期 | 函数**调用方式**（动态） |

`obj.fn()` 触发类似 C++ `__thiscall` 的约定，把 `obj` 地址作为隐藏参数传入栈帧的 `this` 槽位。

**箭头函数的关键差异**：V8 底层**不为箭头函数分配 `this` 槽位**。箭头函数里的 `this` 变成一个普通变量，只能顺着 `context` 指针去外层堆内存找。这就是"箭头函数穿透 `this`"的真相——**物理上少开了一个槽**。

> 以下代码验证了 `this` 的动态绑定和箭头函数的静态穿透：
>
> ```js
> const obj = {
>     name: "obj",
>     normal: function() { return this.name; },
>     arrow: () => this.name
> };
>
> console.log(obj.normal());  // "obj" —— 运行时动态绑定
> console.log(obj.arrow());   // undefined（严格模式）或 global.name（非严格）
>
> // 提取后调用
> const fn1 = obj.normal;
> const fn2 = obj.arrow;
> console.log(fn1());  // undefined —— 普通函数 this 由调用方式决定
> console.log(fn2());  // undefined —— 箭头函数 this 始终穿透到定义时的外层
> ```
