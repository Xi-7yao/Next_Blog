---
slug: nestjs-decorator-deep-dive
title: NestJS 装饰器底层原理系统性解析
date: 2026-05-06
tags: [NestJS, TypeScript, 底层原理, 装饰器]
series:
  name: JavaScript 底层探秘
  order: 2
readTime: 25 min
status: published
---

> 从 TS 编译到 reflect-metadata，从 __decorate 到依赖注入，彻底搞懂 NestJS 装饰器的一切。

## 一、一张图看懂全貌

在深入每一行源码之前，你需要先建立**整体认知**。NestJS 的装饰器体系可以从两个维度理解：

- **架构三层**：TypeScript 编译器（生成元数据）→ `reflect-metadata`（存储元数据）→ NestJS 框架（读取元数据）。这三层回答"体系由哪些部分组成"。
- **执行五阶段**：从写代码到处理请求的完整时间线，回答"这些部分在什么时间点发挥作用"。

下面用五阶段的代码变化来建立直观感受：

**阶段一：源代码（你写的）**

```typescript
@Controller('users')
class UserController {
  constructor(@Inject('CONFIG') private config: Config) {}

  @Get(':id')
  findOne(@Param('id') id: string, @Body() dto: UpdateUserDto) {}
}
```

**阶段二：编译后（tsc 输出）**

```typescript
// 类装饰器（返回值会重新赋给 UserController）
UserController = __decorate([
    Controller('users')
], UserController);

// 构造函数参数装饰器（目标为类本身，propertyKey 为 undefined）
__decorate([
    __param(0, Inject('CONFIG'))
], UserController, undefined, 0);

// 方法装饰器 + 参数装饰器（同目标的装饰器合并到同一个 __decorate）
__decorate([
  Get(':id'),
  __param(0, Param('id')),
  __param(1, Body())
], UserController.prototype, "findOne", null);

// TS 自动注入参数类型元数据（仅构造函数有）
__metadata('design:paramtypes', [String, UpdateUserDto]);
```

**阶段三：运行时加载（Node.js require 时执行）**

```typescript
// 装饰器函数执行，元数据写入内存
Reflect.defineMetadata('path', 'users', UserController);
Reflect.defineMetadata('__routeArguments__', {
  '3:0': { index: 0, data: 'id', pipes: [] },      // @Param('id')
  '3:1': { index: 1, data: undefined, pipes: [] }, // @Body()
}, UserController.prototype, 'findOne');
Reflect.defineMetadata('design:paramtypes', [String, UpdateUserDto], UserController);
```

**阶段四：NestJS 启动（NestFactory.create()）**

```typescript
// DependenciesScanner 扫描 @Module 装饰的类 → 构建模块依赖树
// RouterExplorer 读取 @Controller/@Get 元数据 → 注册路由表
// Injector 读取 design:paramtypes → 解析依赖图 → 实例化 Controller/Provider
const app = await NestFactory.create(AppModule);
```

**阶段五：HTTP 请求处理**

```typescript
// GET /users/123, Body: {name: "Alice"}
// RouterExecutionContext 读取 __routeArguments__ 元数据
// → RouteParamsFactory.exchangeKeyForValue(3, 'id', req) → '123'
// → RouteParamsFactory.exchangeKeyForValue(3, undefined, req) → req.body
// → callback.apply(instance, ['123', {name: "Alice"}])
```

本文有两条主线：
- **主线 A（编译期）**：TS 如何把 `@装饰器` 语法糖翻译成 `__decorate` 调用，以及 `__metadata`/`__param` 等辅助函数的作用。
- **主线 B（运行时）**：`reflect-metadata` 如何存储元数据，以及 NestJS 如何在启动时和请求时读取这些元数据。

贯穿两条主线的，是**从编译到请求的五个阶段**。先记住它们，后面每一节都会对应到其中某个阶段：

| 阶段 | 发生时机 | 核心动作 | 对应本文 |
|------|----------|----------|----------|
| 阶段一：编译期 | `tsc` 编译时 | 生成 `__decorate`、`__metadata`、`__param` | 第 3、6 节 |
| 阶段二：运行时加载 | Node.js `require()` 模块时 | 执行装饰器函数，元数据写入内存 | 第 4、7 节 |
| 阶段三：启动扫描 | `NestFactory.create()` 时 | 读取元数据，构建模块树和路由表 | 第 8 节 |
| 阶段四：依赖注入 | 实例化 Controller/Provider 时 | 读取 `design:paramtypes`，解析依赖 | 第 8 节 |
| 阶段五：HTTP 请求 | 请求到来时 | 读取 `__routeArguments__`，提取参数 | 第 8 节 |

---

## 二、装饰器解决了什么问题

在深入源码之前，先回答一个根本问题：**如果没有装饰器，NestJS 要怎么工作？**

假设你要写一个 Controller：

```typescript
class UserController {
    constructor(private userService: UserService) {}
    findAll() { return this.userService.findAll(); }
}
```

NestJS 怎么知道 `UserController` 是一个控制器？它的路由前缀是什么？`findAll` 方法对应哪个 HTTP 方法和路径？构造函数的参数需要注入什么？

**没有装饰器的笨拙方案：**

```typescript
// 手动注册路由
router.register(UserController, { prefix: '/users' });
router.get(UserController.prototype.findAll, { path: '/', method: 'GET' });

// 手动声明依赖
container.register(UserController, { deps: [UserService] });
container.register(UserService, { deps: ['DATABASE'] });
```

这种方式的问题很明显：**元数据（路由配置、依赖配置）和类定义是分离的**。你写类的时候在一个文件，注册配置的时候在另一个文件，维护起来极其痛苦。

**装饰器的核心作用**就是把元数据**直接附加在类、方法、参数本身上**，让框架可以在运行时通过反射读取这些元数据，自动完成路由注册和依赖注入。

NestJS 的装饰器本质上只做一件事：**调用 `Reflect.defineMetadata(key, value, target)` 把配置信息写入内存**。剩下的工作——扫描类、读取元数据、构建依赖图、注册路由——都由框架在启动时自动完成。

---

## 三、三类装饰器的编译前后对比

要理解装饰器的底层，必须先看 TypeScript 编译器把 `@Decorator` 语法糖翻译成了什么。下面三节分别对比类装饰器、方法装饰器、参数装饰器的编译结果。

> **对应阶段**：阶段一（编译期）

### 3.1 类装饰器：@Controller('users')

**源代码：**

```typescript
@Controller('users')
class UserController {}
```

**编译后（简化）：**

```javascript
let UserController = class UserController {};

// 类装饰器的编译结果
UserController = __decorate([
    Controller('users')
], UserController);
```

执行过程：
1. `Controller('users')` 执行，返回一个函数 `decoratorFn`
2. `__decorate([decoratorFn], UserController)` 被调用
3. `__decorate` 内部执行 `decoratorFn(UserController)`
4. `decoratorFn` 内部调用 `Reflect.defineMetadata('path', 'users', UserController)`

### 3.2 方法装饰器：@Get(':id')

**源代码：**

```typescript
class UserController {
    @Get(':id')
    findAll() {}
}
```

**编译后（简化）：**

```javascript
class UserController {
    findAll() {}
}

__decorate([
    Get(':id')
], UserController.prototype, "findAll", null);
```

注意这里的四个参数：
- `decorators = [Get(':id')]` —— 装饰器数组
- `target = UserController.prototype` —— 类的原型对象
- `key = "findAll"` —— 方法名字符串
- `desc = null` —— null 表示让 `__decorate` 自己获取 descriptor

`__decorate` 内部会调用 `Object.getOwnPropertyDescriptor(UserController.prototype, "findAll")` 获取 descriptor，然后传给 `Get(':id')` 返回的函数。

### 3.3 参数装饰器：@Body()

**源代码：**

```typescript
class UserController {
    findAll(@Body() dto: any) {}
}
```

**编译后（简化）：**

```javascript
class UserController {
    findAll(dto) {}
}

__decorate([
    __param(0, Body())
], UserController.prototype, "findAll", null);
```

参数装饰器不能直接参与 `__decorate`，因为 `__decorate` 只接受 `(target, key, descriptor)` 签名的函数。所以 TS 用 `__param(0, Body())` 把参数装饰器包装成方法装饰器形式：

```javascript
// __param 的展开
__param(0, Body())  →  function(target, key) { Body()(target, key, 0); }
```

这样 `__decorate` 调用它时，就会把 `(UserController.prototype, "findAll", 0)` 传给 `Body()` 返回的原始参数装饰器函数。

> **核心结论**：参数装饰器的标准签名是 `(target, key, index)`，但 `__decorate` 只能传递 `(target, key, descriptor)`。`__param` 的本质是**签名适配器**——把 `index` 通过闭包固定，伪装成方法装饰器混入 `__decorate` 的调用队列。

### 3.4 三者叠加的完整编译结果

**源代码：**

```typescript
@Controller('users')
class UserController {
    constructor(private service: UserService) {}

    @Get(':id')
    findAll(@Body() dto: any) {}
}
```

**编译后：**

```javascript
// 1. TS 自动注入的辅助函数（文件顶部）
var __decorate = function(decorators, target, key, desc) { ... };
var __metadata = function(k, v) { ... };
var __param = function(paramIndex, decorator) { ... };

// 2. 类定义
let UserController = class UserController {
    constructor(service) { this.service = service; }
    findAll(dto) {}
};

// 3. 类装饰器
UserController = __decorate([
    Controller('users'),
    __metadata('design:paramtypes', [UserService])  // TS 自动生成
], UserController);

// 4. 方法装饰器 + 参数装饰器
__decorate([
    __param(0, Body()),
    Get(':id'),
    __metadata('design:type', Function),
    __metadata('design:paramtypes', [Object]),
    __metadata('design:returntype', void 0)
], UserController.prototype, "findAll", null);
```

以上就是编译后的完整图景。接下来三节，我们将逐个拆解三个核心问题：**元数据存在哪里**、`__decorate` 怎么调度执行、以及 `__metadata` 和 `__param` 分别解决了什么问题。

---

## 四、reflect-metadata：一切元数据的存储层

所有装饰器——无论是 TS 自动生成的还是 NestJS 自定义的——最终都在调用 `reflect-metadata` 的 API。理解这一层，是读懂后续一切的基础。

> **对应阶段**：阶段二（运行时加载）。当 Node.js 加载模块并执行到 `__decorate` 时，元数据就是通过这里写入内存的。

### 4.1 核心 API

```typescript
// 写元数据
Reflect.defineMetadata(key, value, target);
Reflect.defineMetadata(key, value, target, propertyKey);

// 读元数据
Reflect.getMetadata(key, target);
Reflect.getMetadata(key, target, propertyKey);
```

### 4.2 存储位置的秘密

`reflect-metadata` 不把元数据存在对象本身（不会污染 `target` 的属性），而是维护一个**全局的 WeakMap**：

```typescript
const Metadata = new WeakMap();

function defineMetadata(key, value, target, propertyKey?) {
    const metadataKey = propertyKey ? `${key}:${propertyKey}` : key;
    const existing = Metadata.get(target) || {};
    existing[metadataKey] = value;
    Metadata.set(target, existing);
}
```

使用 `WeakMap` 的好处是：当 `target`（类构造函数或原型对象）不再被引用时，元数据会自动被垃圾回收，不会内存泄漏。

**可视化**：`Metadata WeakMap` 中的内容大概长这样：

```
Metadata WeakMap {
  ├─ UserController（构造函数）
  │     ├─ 'path' → 'users'
  │     ├─ '__controller__' → true
  │     └─ 'design:paramtypes' → [UserService]
  │
  ├─ UserController.prototype（原型对象）
  │     └─ 'findAll:design:type' → Function
  │
  ├─ findAll 方法函数本身（descriptor.value）
  │     ├─ 'path' → ':id'
  │     └─ 'method' → 0   // GET
  │
  └─ ...
}
```

注意：方法级别的路由元数据（如 `path`、`method`）是打在 `descriptor.value`（即方法函数本身）上的，而不是 `UserController.prototype` 上。因为原型对象被类的所有方法共享，如果打在原型上，不同方法的元数据会互相覆盖。

### 4.3 NestJS 的核心元数据键

```typescript
CONTROLLER_WATERMARK = '__controller__'     // 标记类为控制器
INJECTABLE_WATERMARK = '__injectable__'     // 标记类为可注入
PATH_METADATA = 'path'                      // 路由路径
METHOD_METADATA = 'method'                  // HTTP 方法（GET=0, POST=1...）
PARAMTYPES_METADATA = 'design:paramtypes'   // TS 自动生成的构造参数类型数组
SELF_DECLARED_DEPS_METADATA = 'self:paramtypes'  // @Inject() 显式声明的依赖
ROUTE_ARGS_METADATA = '__routeArguments__'  // 路由参数配置（@Body, @Param 等）
MODULE_METADATA = { IMPORTS, PROVIDERS, CONTROLLERS, EXPORTS }
```

---

## 五、__decorate：装饰器调度器

看完编译结果，你可能会问：`__decorate` 为什么不直接执行装饰器，而是要逆序遍历？为什么要根据 `arguments.length` 区分 2、3、4 三种情况？带着这两个问题看源码。

> **对应阶段**：阶段一（编译期生成）+ 阶段二（运行时执行）。

### 5.1 源码

```javascript
var __decorate = function(decorators, target, key, desc) {
    var c = arguments.length;
    
    // 根据参数数量判断装饰器类型，准备初始的 r（返回值/描述符）
    var r = c < 3 
        ? target                                           // 类装饰器：r = 构造函数
        : desc === null 
            ? (desc = Object.getOwnPropertyDescriptor(target, key))  // 方法装饰器：获取 descriptor
            : desc;                                        // 属性/访问器装饰器：使用传入的 descriptor
    
    // 逆序遍历装饰器数组（从下往上执行）
    for (var i = decorators.length - 1; i >= 0; i--) {
        var d = decorators[i](target, key, r);
        r = d || r;  // 如果装饰器返回了新值，用它替换 r
    }
    
    // 方法/访问器装饰器：如果最终返回了新的 descriptor，重定义属性
    if (c > 3 && r) {
        Object.defineProperty(target, key, r);
    }
    
    return r;
};
```

### 5.2 解决的三个核心问题

**问题一：多个装饰器的执行顺序**

```typescript
@A()
@B()
class Foo {}
```

编译后：`__decorate([A(), B()], Foo)`。

TS 规范规定装饰器是**从下往上执行**（`@A` 先，`@B` 后），所以 `__decorate` 从数组末尾往前遍历：

```
i=1: 执行 B()(Foo)  →  可能返回新的类
i=0: 执行 A()(Foo)  →  接收 B() 的返回值作为 target
```

**问题二：descriptor 的传递链**

方法装饰器可以返回新的 descriptor，`__decorate` 会把新的 descriptor 传给下一个装饰器：

```
初始 descriptor → 装饰器 A 返回新 descriptor → 装饰器 B 接收新 descriptor
```

**问题三：统一四种装饰器类型**

| 调用方式 | c = arguments.length | 装饰器类型 |
|---------|---------------------|-----------|
| `__decorate([...], Target)` | 2 | 类装饰器 |
| `__decorate([...], Target, "key")` | 3 | 属性装饰器 |
| `__decorate([...], Target, "key", desc)` | 4 | 方法/访问器装饰器 |

---

## 六、TS 自动注入的辅助函数：__metadata 与 __param

除了 `__decorate`，TS 编译器还会自动生成另外两个辅助函数。它们不像 `__decorate` 那样直接调度装饰器，而是负责**补充元数据**和**适配参数装饰器签名**。

### 6.1 __metadata：类型元数据注入器

`__metadata` 是 TS 在 `emitDecoratorMetadata: true` 时自动生成的辅助函数。它的唯一作用：**让 TS 能在编译时自动推断类型并注入元数据**。

**源码：**

```javascript
var __metadata = function(k, v) {
    return function(target, key) {
        Reflect.metadata(k, v)(target, key);
    };
};
```

展开后等价于：

```javascript
Reflect.defineMetadata(k, v, target, key);
```

**它是怎么被插入的**

当你写：

```typescript
@Injectable()
class UserService {
    constructor(private repo: UserRepository) {}
}
```

TypeScript 编译器会自动在输出中插入：

```javascript
UserService = __decorate([
    Injectable(),
    __metadata('design:paramtypes', [UserRepository])  // ← TS 自动插入！
], UserService);
```

**注意**：TS 只会在**类有装饰器**时才生成 `design:paramtypes`。如果 `UserService` 没有 `@Injectable()`，TS 就不会为它生成参数类型元数据。这也是为什么 NestJS 要求所有 Provider 必须加 `@Injectable()` —— 没有类装饰器，TS 就不会生成 `design:paramtypes`，NestJS 就读不到构造参数的类型信息。

**三个自动生成的 design: 元数据**

| 元数据键 | 来源 | 何时生成 |
|---------|------|---------|
| `design:type` | 属性装饰器 | `@Body()` 等参数装饰器触发 |
| `design:paramtypes` | 构造函数 | 类有装饰器时 |
| `design:returntype` | 方法装饰器 | 方法有装饰器时 |

### 6.2 __param：参数装饰器包装器

参数装饰器的标准签名是 `(target, key, index)`，但 `__decorate` 只接受方法装饰器形式的函数 `(target, key, descriptor)`。`__param` 就是用来桥接这个差异的。

**源码：**

```javascript
var __param = function(paramIndex, decorator) {
    return function(target, key) {
        decorator(target, key, paramIndex);
    };
};
```

**工作流程**

```typescript
class C {
    foo(@Body() dto: any) {}
}
```

编译后：

```javascript
__decorate([
    __param(0, Body())   // ← 包装器
], C.prototype, "foo", null);
```

执行过程：

```
1. Body() 返回参数装饰器函数 fn = (target, key, index) => { ... }
2. __param(0, fn) 返回包装函数 wrapper = (target, key) => fn(target, key, 0)
3. __decorate 调用 wrapper(C.prototype, "foo")
4. wrapper 内部调用 fn(C.prototype, "foo", 0)
5. fn 内部读取 target.constructor（即类 C），然后执行：
   Reflect.defineMetadata('__routeArguments__', ..., C, "foo")
   // 注意：元数据最终存在 (类, 方法名) 这对键上，便于启动时扫描
```

---

## 七、NestJS 装饰器的实现原理

讲完了 TS 编译器和 `reflect-metadata` 的底层机制，现在来看 NestJS 自身的装饰器是怎么利用这些基础设施的。

> **对应阶段**：阶段二（运行时加载）。以下代码经过简化，保留了核心逻辑。

### 7.1 @Controller() —— 类装饰器

```typescript
function Controller(prefixOrOptions) {
    const [path, host, scopeOptions, versionOptions] = parseOptions(prefixOrOptions);
    return (target) => {
        Reflect.defineMetadata('__controller__', true, target);
        Reflect.defineMetadata('path', path, target);
        Reflect.defineMetadata('host', host, target);
        Reflect.defineMetadata('scope:options', scopeOptions, target);
        Reflect.defineMetadata('__version__', versionOptions, target);
    };
}
```

> **核心结论**：类装饰器接收 `target`（类构造函数），直接把元数据打在构造函数本身上。NestJS 启动扫描时，用 `Reflect.getMetadata('__controller__', UserController)` 就能判断这个类是不是控制器。

### 7.2 @Get() —— 方法装饰器

```typescript
const RequestMapping = (metadata) => {
    const path = metadata['path'] || '/';
    const requestMethod = metadata['method'] || RequestMethod.GET;
    return (target, key, descriptor) => {
        // 关键：元数据附加在 descriptor.value（方法函数本身）上
        Reflect.defineMetadata('path', path, descriptor.value);
        Reflect.defineMetadata('method', requestMethod, descriptor.value);
        return descriptor;
    };
};

const createMappingDecorator = (method) => (path) => {
    return RequestMapping({ path, method });
};

export const Get = createMappingDecorator(RequestMethod.GET);
```

**为什么打在 `descriptor.value` 上而不是 `target` 上？**

因为 `target` 是 `UserController.prototype`，所有方法共享同一个原型对象。如果元数据打在原型上，一个类的所有方法会互相覆盖。而 `descriptor.value` 是每个方法**独立的函数对象**，可以作为独立的元数据载体。

### 7.3 @Inject() —— DI 参数装饰器

```typescript
function Inject(token?: string | symbol | Type<any>) {
    return (target: any, key: string | symbol | undefined, index?: number) => {
        // 注意：构造函数参数注入时，key === undefined
        // 属性注入时，key 是属性名，index 不存在
        
        if (index !== undefined) {
            // ========== 构造函数参数注入 ==========
            // target 是类本身（因为构造函数参数装饰器的 target 是构造函数）
            // 实际 NestJS 中，这里会把依赖信息存入 SELF_DECLARED_DEPS_METADATA
            let dependencies = Reflect.getMetadata('self:paramtypes', target) || [];
            dependencies = [...dependencies, { index, param: token }];
            Reflect.defineMetadata('self:paramtypes', dependencies, target);
        } else {
            // ========== 属性注入 ==========
            // key 是属性名
            const type = token || Reflect.getMetadata('design:type', target, key);
            Reflect.defineMetadata('self:properties_metadata', { key, type }, target);
        }
    };
}
```

> **核心结论**：构造函数参数注入和属性注入共用 `@Inject()`，但底层走的是完全不同的路径。构造函数注入依赖 `index`（参数下标），属性注入依赖 `key`（属性名）。NestJS 启动时会分别读取 `self:paramtypes` 和 `self:properties_metadata` 来解析依赖。

### 7.4 @Body() —— 路由参数装饰器

```typescript
function createRouteParamDecorator(paramtype) {
    return (data) => (target, key, index) => {
        // target 是类的 prototype，所以 target.constructor 才是类本身
        const args = Reflect.getMetadata('__routeArguments__', target.constructor, key) || {};
        const newArgs = {
            ...args,
            [`${paramtype}:${index}`]: { index, data, pipes: [] }
        };
        Reflect.defineMetadata('__routeArguments__', newArgs, target.constructor, key);
    };
}

export const Body = createRouteParamDecorator(RouteParamtypes.BODY);   // 3
export const Param = createRouteParamDecorator(RouteParamtypes.PARAM); // 5
```

**数据结构：**

```typescript
// findOne(@Param('id') id: string, @Body() dto: UpdateUserDto)
// 存储在 (UserController, 'findOne') 这对键上
{
    '5:0': { index: 0, data: 'id', pipes: [] },        // PARAM = 5
    '3:1': { index: 1, data: undefined, pipes: [] }    // BODY = 3
}
```

---

## 八、从编译到请求：完整时间线

把前面所有碎片串起来，下面是从你写下 `@Controller('users')` 到 HTTP 请求被处理的完整旅程。

### 阶段一：编译期（tsc）

```
源代码 @Controller('users') + @Get(':id') + @Body()
    ↓
TypeScript 编译器
    ↓
1. 生成 __decorate / __metadata / __param 辅助函数（文件顶部）
2. 类装饰器 → __decorate([Controller('users')], UserController)
3. 方法装饰器 → __decorate([Get(':id')], UserController.prototype, "findAll", null)
4. 参数装饰器 → __decorate([__param(0, Body())], ...)
5. TS 自动插入 __metadata('design:paramtypes', [...])
```

### 阶段二：运行时加载（Node.js 执行 JS）

```
加载 UserController.js
    ↓
1. Controller('users')(UserController)
   └─→ Reflect.defineMetadata('path', 'users', UserController)
   └─→ Reflect.defineMetadata('__controller__', true, UserController)

2. Get(':id')(UserController.prototype, 'findAll', descriptor)
   └─→ Reflect.defineMetadata('path', ':id', descriptor.value)
   └─→ Reflect.defineMetadata('method', 0, descriptor.value)

3. Body()(UserController.prototype, 'findAll', 0)
   └─→ Reflect.defineMetadata('__routeArguments__',
                               {'3:0': {index:0, data:undefined, pipes:[]}},
                               UserController, 'findAll')
       // 注意：target 是 UserController.prototype，target.constructor 才是 UserController

4. __metadata('design:paramtypes', [Object])(UserController.prototype, 'findAll')
   └─→ Reflect.defineMetadata('design:paramtypes', [Object], UserController.prototype, 'findAll')
```

### 阶段三：NestJS 启动扫描

```
NestFactory.create(AppModule)
    ↓
DependenciesScanner.scan()
    ├─ scanForModules()
    │   └─ Reflect.getMetadata('imports', AppModule) → [AuthModule]
    │   └─ 递归扫描所有子模块
    │
    ├─ scanModulesForDependencies()
    │   ├─ Reflect.getMetadata('controllers', AppModule) → [UserController]
    │   ├─ Reflect.getMetadata('providers', AppModule) → [UserService]
    │   └─ isController(UserController)
    │       └─ Reflect.getMetadata('__controller__', UserController) → true
    │
    └─ RouterExplorer 扫描路由
        ├─ Reflect.getMetadata('path', UserController) → 'users'
        ├─ 遍历 UserController.prototype 的所有方法
        │   ├─ Reflect.getMetadata('path', findAll函数) → ':id'
        │   └─ Reflect.getMetadata('method', findAll函数) → 0 (GET)
        └─ app.get('/users/:id', routeHandler)
```

### 阶段四：依赖注入

```
Injector 实例化 UserController
    ├─ reflectConstructorParams(UserController)
    │   ├─ design:paramtypes = [UserService, Object]
    │   ├─ self:paramtypes = [{index:1, param:'CONFIG'}]
    │   └─ 合并（后者覆盖前者）→ [UserService, 'CONFIG']
    │
    ├─ 解析 UserService → 递归实例化（同样的流程）
    ├─ 解析 'CONFIG' → 从 providers 中查找对应 token 的实例
    └─ new UserController(userServiceInstance, configInstance)
```

### 阶段五：HTTP 请求

```
GET /users/123, Body: {"name":"Alice"}
    ↓
RouterExecutionContext.create()
    ├─ Reflect.getMetadata('__routeArguments__', UserController, 'findAll')
    │   → {'5:0': {index:0, data:'id'}, '3:1': {index:1, data:undefined}}
    │
    ├─ RouteParamsFactory.exchangeKeyForValue(5, 'id', {req})
    │   → req.params['id'] → '123'
    ├─ RouteParamsFactory.exchangeKeyForValue(3, undefined, {req})
    │   → req.body → {name: 'Alice'}
    │
    └─ callback.apply(instance, ['123', {name: 'Alice'}])
        // 最终调用 UserController.findAll('123', {name: 'Alice'})
```

---

## 九、总结

| 层级 | 角色 | 代表 | 对应章节 |
|------|------|------|----------|
| TypeScript 编译器 | 把装饰器语法翻译成 `__decorate` 调用，自动注入 `design:paramtypes` | `__decorate`, `__metadata`, `__param` | 第 5、6 节 |
| reflect-metadata | 提供元数据的读写 API，底层用 WeakMap 存储 | `Reflect.defineMetadata`, `Reflect.getMetadata` | 第 4 节 |
| NestJS 装饰器 | 把业务配置（路由、依赖）写入元数据 | `@Controller`, `@Get`, `@Inject`, `@Body` | 第 7 节 |
| NestJS 扫描器 | 启动时读取元数据，构建应用结构 | `DependenciesScanner`, `RouterExplorer` | 第 8 节（阶段三） |
| NestJS 注入器 | 根据元数据解析依赖，创建实例 | `Injector` | 第 8 节（阶段四） |
| NestJS 路由执行器 | 请求到来时根据元数据提取参数 | `RouterExecutionContext`, `RouteParamsFactory` | 第 8 节（阶段五） |

---

## 附录：如何阅读本文（学习路径建议）

如果你是**第一次接触 NestJS 装饰器底层**，建议按以下顺序阅读：

1. **先读第 1 节（全貌）+ 第 2 节（问题）**：建立"为什么需要装饰器"的直觉。
2. **再读第 8 节（完整时间线）的五个阶段标题**：记住"编译→加载→扫描→注入→请求"的主线。
3. **带着问题深入第 3-7 节**：每个小节都对应时间线中的某个阶段，读完回头看对应阶段会豁然开朗。
4. **最后对照第 9 节（总结表格）**：把碎片整理成体系，尝试用自己的话复述每一层的职责。

如果你是**复习回顾**，建议直接从**第 8 节（完整时间线）**开始，遇到记不清的细节再跳转到对应章节查漏补缺。
