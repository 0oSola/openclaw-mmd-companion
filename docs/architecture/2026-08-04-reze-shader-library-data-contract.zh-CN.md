# Reze 着色器图库数据契约

日期：2026-08-04

状态：规范性设计契约，尚未实现

适用范围：`reze-design`、`reze-k3`

## 1. 契约目标

本文固定 Reze 着色器工作流第一版的机器字段、枚举、迁移、仓储、异步提交和编辑草稿边界。实现可以调整模块拆分，但不得改变本文的用户可见语义。

本文不替代 `reze-engine` 公共类型。`ShaderGraph`、`GraphNode`、`GraphLink`、`ExposedParam`、`Diagnostic`、`RenderClass`、`AlphaMode` 和 `StyleGroup` 的结构与校验仍以当前安装的 `reze-engine@0.26.0` 为源头。

## 2. 固定枚举

### 2.1 材质类别样式组

```ts
export type RezeMaterialStyleGroupId =
  | "default"
  | "body"
  | "eye"
  | "face"
  | "hair"
  | "metal"
  | "cloth_rough"
  | "cloth_smooth"
  | "stockings"
  | "ungrouped";
```

显示与推荐图映射：

| 机器值 | 中文显示 | 英文显示 | 推荐内置图 |
|---|---|---|---|
| `default` | 默认材质 | Principled BSDF | `默认` |
| `body` | 角色皮肤 | Body | `角色皮肤` |
| `eye` | 眼睛 | Eye | `眼睛` |
| `face` | 面部 | Face | `面部` |
| `hair` | 头发 | Hair | `头发` |
| `metal` | 金属 | Metal | `金属` |
| `cloth_rough` | 粗糙布料 | Rough Cloth | `粗糙布料` |
| `cloth_smooth` | 柔滑布料 | Smooth Cloth | `柔滑布料` |
| `stockings` | 丝袜 | Stockings | `丝袜` |
| `ungrouped` | 未分组 | Ungrouped | 无 |

界面统一显示为`中文（English）`。

### 2.2 内置图标识

```ts
export type RezeBuiltInShaderGraphId =
  | "默认"
  | "角色皮肤"
  | "眼睛"
  | "面部"
  | "头发"
  | "金属"
  | "粗糙布料"
  | "柔滑布料"
  | "丝袜";
```

`半透材质`不属于新枚举，只作为 v1 迁移输入接受。

### 2.3 稳定图引用

```ts
export type RezeShaderGraphRef =
  | `builtin:${RezeBuiltInShaderGraphId}`
  | `local:${string}`;
```

约束：

- 内置图示例：`builtin:面部`；
- 本地图示例：`local:550e8400-e29b-41d4-a716-446655440000`；
- 本地图 ID 使用 `crypto.randomUUID()`生成；
- 场景文档只保存该引用，不保存图 JSON；
- 不接受无来源前缀的 v2 图引用。

### 2.4 渲染集成元数据

```ts
export type RezeShaderRenderClass = "auto" | "eye" | "hair";
export type RezeShaderAlphaMode = "opaque" | "hashed";
```

这两个枚举由引擎拥有，用户不能创建新值。

内置图清单：

| 图引用 | `renderClass` | `alphaMode` | 推荐类别 |
|---|---|---|---|
| `builtin:默认` | `auto` | `opaque` | `default` |
| `builtin:角色皮肤` | `auto` | `opaque` | `body` |
| `builtin:眼睛` | `eye` | `opaque` | `eye` |
| `builtin:面部` | `auto` | `opaque` | `face` |
| `builtin:头发` | `hair` | `opaque` | `hair` |
| `builtin:金属` | `auto` | `opaque` | `metal` |
| `builtin:粗糙布料` | `auto` | `opaque` | `cloth_rough` |
| `builtin:柔滑布料` | `auto` | `opaque` | `cloth_smooth` |
| `builtin:丝袜` | `auto` | `hashed` | `stockings` |

应用到非推荐类别时仍使用图自己的 `renderClass`和`alphaMode`，类别不得覆盖。

## 3. 引擎图契约

当前公共图结构为：

```ts
export type ShaderGraph = {
  version: 1;
  name: string;
  nodes: GraphNode[];
  links: GraphLink[];
  output: { node: string; socket: string };
  params?: ExposedParam[];
  tags?: string[];
};
```

规范化和编辑必须保留以下引擎约束：

- `version`必须为`1`；
- 节点最多 64 个；
- 暴露参数最多 16 个；
- 节点 ID 必须匹配`/^[a-z0-9_]+$/`且图内唯一；
- 节点类型必须存在于当前 `NODE_REGISTRY`；
- 当前注册表基线为 40 种节点类型；
- 单个输入插槽最多一条入边；
- 链接源、目标和插槽必须存在，类型必须可转换；
- `vec4`颜色坡度停止值只能是字面量，不能作为链接目标；
- 暴露参数只能覆盖未连接的字面量输入；
- 图不得有循环；
- 最终输出必须可解析为颜色或浮点值；
- `GraphNode.ui.position`是编辑器元数据，编译器忽略但序列化必须往返保留。

宿主不得复制一套与引擎不一致的校验器。导入、保存、预览和应用都以 `validateGraph()`及`compileGraph()`结果为准。

## 4. 第二版场景文档

### 4.1 类型

```ts
export type RezeMaterialKey = string;

export type RezeStageDocumentV2 = {
  version: 2;
  name: string;
  updatedAt: string;
  scene: RezeStageSceneSettings;
  grade: RezeGradePreset;
  gradeIntensity: number;
  backgroundEffect: RezeBackgroundEffect;

  groupGraphBindings: Partial<
    Record<RezeMaterialStyleGroupId, RezeShaderGraphRef>
  >;

  materialGraphOverrides: Record<
    RezeMaterialKey,
    RezeShaderGraphRef
  >;

  materialGroupOverrides: Record<
    RezeMaterialKey,
    RezeMaterialStyleGroupId
  >;
};
```

### 4.2 字段语义

`groupGraphBindings`（样式组基线）：

- 缺少标准类别键表示使用该类别推荐内置图；
- 缺少 `ungrouped`键表示使用引擎中性回退；
- 存在键表示用户显式选择该图；
- 组级“恢复推荐图”删除对应键，不写推荐图值；
- 未分组的恢复操作也删除对应键。

`materialGraphOverrides`（单材质图覆盖）：

- 缺少材质键表示跟随最终样式组；
- 存在`builtin:默认`表示显式使用默认图，不表示继承；
- 跨组移动不得删除该字段；
- “跟随样式组”与“重置此材质”删除对应键。

`materialGroupOverrides`（人工分组覆盖）：

- 缺少材质键表示使用自动分类；
- 存在键表示用户人工移动；
- “恢复自动分组”删除对应键；
- “重置此材质”和“恢复全部默认”不得删除该字段。

`RezeMaterialKey`（材质键）：

- 由当前舞台运行时提供，场景层必须视为不透明字符串；
- 当前已有形态包括`reze:material:<序号>`和`mesh:<遍历序号>:material:<槽位>`；
- 业务逻辑不得通过拆分字符串推导材质索引、名称或类别；
- 模型重载后，运行时必须为同一 PMX 给出稳定键。

### 4.3 最终绑定解析

对每个材质：

```text
effectiveGroup =
  materialGroupOverrides[materialKey]
  ?? autoClassifiedGroup(material)

effectiveGraph =
  materialGraphOverrides[materialKey]
  ?? groupGraphBindings[effectiveGroup]
  ?? recommendedBuiltInGraph[effectiveGroup]
  ?? engineNeutralFallback
```

该算法是规范性顺序，所有 UI、预览、导出和运行时重建必须共用同一实现。

### 4.4 存储键

```text
mmd_reze_editor_scene_v2:<userId>:<pipeline>:<modelPath>
```

约束：

- `pipeline`第一版只允许`reze-design`或`reze-k3`；
- `userId`、`pipeline`、`modelPath`都参与隔离；
- 导入文档时使用当前上下文生成键，不能信任 JSON 内的外部存储键；
- v2 文档不保存 `userId`、`pipeline`或`modelPath`副本。

## 5. v1→v2 迁移契约

### 5.1 读取顺序

1. 读取当前上下文的 v2 键；
2. v2 存在时，只规范化 v2，不读取 v1；
3. v2 不存在时，读取同一上下文的 v1 键；
4. v1 有效时迁移到内存 v2；
5. 规范化和迁移全部成功后写入 v2；
6. 永久保留原 v1 键，第一版不自动删除。

### 5.2 字段迁移

| v1 字段 | v2 字段 | 规则 |
|---|---|---|
| `version` | `version` | 固定写`2` |
| `name` | `name` | 沿用现有 60 字符规范化 |
| `updatedAt` | `updatedAt` | 迁移写入时更新为当前 ISO 时间 |
| `scene` | `scene` | 使用当前管线默认值补齐 |
| `grade` | `grade` | 保留有效枚举 |
| `gradeIntensity` | `gradeIntensity` | 限制到 0–1 |
| `backgroundEffect` | `backgroundEffect` | 保留有效枚举 |
| `materialPresets` | `materialGraphOverrides` | 按下表转换 |
| 无 | `groupGraphBindings` | `{}` |
| 无 | `materialGroupOverrides` | `{}` |

### 5.3 旧预设映射

| v1 值 | v2 图引用 |
|---|---|
| `默认` | `builtin:默认` |
| `角色皮肤` | `builtin:角色皮肤` |
| `眼睛` | `builtin:眼睛` |
| `面部` | `builtin:面部` |
| `头发` | `builtin:头发` |
| `金属` | `builtin:金属` |
| `粗糙布料` | `builtin:粗糙布料` |
| `柔滑布料` | `builtin:柔滑布料` |
| `丝袜` | `builtin:丝袜` |
| `半透材质` | `builtin:柔滑布料` |

未知值不迁移，但必须计入警告。不得因为一个未知值放弃其他有效条目。

### 5.4 迁移结果

```ts
export type RezeStageMigrationReport = {
  sourceVersion: 1;
  targetVersion: 2;
  migratedMaterialOverrideCount: number;
  migratedLegacyTranslucentCount: number;
  ignoredUnknownPresetCount: number;
  warnings: string[];
};
```

如果 v1 JSON 无法解析、基础字段不是对象或 v2 写入失败：

- 不覆盖 v1；
- 不写空 v2；
- 返回失败诊断；
- 页面可以使用内存默认值继续运行，但必须显示“旧场景未迁移”，不得显示迁移成功。

## 6. 本地图资产

### 6.1 IndexedDB

数据库名称：

```text
mmd_reze_shader_library
```

数据库版本：`1`

对象仓储：

| 仓储名 | 主键 | 用途 |
|---|---|---|
| `shaderAssets` | `id` | 本地图和编辑草稿 |
| `shaderFavorites` | `[userId, graphRef]` | 当前用户对内置或本地图的收藏 |

建议索引：

- `shaderAssets.byUserUpdatedAt`：`[userId, updatedAt]`；
- `shaderAssets.byUserState`：`[userId, state]`；
- `shaderFavorites.byUserCreatedAt`：`[userId, createdAt]`。

所有读取必须显式带当前 `userId`过滤。仅依赖主键读取后再在 UI 过滤不满足用户隔离。

### 6.2 本地图资产类型

```ts
export type RezeShaderGraphAssetV1 = {
  schema: "reze-shader-asset";
  version: 1;
  id: `local:${string}`;
  userId: string;
  state: "draft" | "ready";

  name: {
    zh: string;
    en: string;
  };

  graph: ShaderGraph;
  renderClass: RezeShaderRenderClass;
  alphaMode: RezeShaderAlphaMode;
  recommendedGroups: RezeMaterialStyleGroupId[];
  tags: string[];
  description: string;

  source: {
    kind: "blank" | "builtin-copy" | "local-copy" | "json-import";
    graphRef?: RezeShaderGraphRef;
  };

  createdAt: string;
  updatedAt: string;
};
```

规范化规则：

- `id`必须以`local:`开头且后缀为有效 UUID；
- `userId`必须等于当前会话用户；
- `name.zh`为空时回退到`graph.name`，仍为空时使用“未命名图”；
- `name.en`允许为空；
- `recommendedGroups`去重，只保留固定枚举；
- `tags`去除首尾空白、空值和重复值；
- `graph.tags`是引擎软提示，资产`tags`是图库元数据；导入时可从图标签初始化，但保存后分别往返；
- `state=draft`的图不能被新场景正式绑定；
- `state=ready`只表示曾通过宿主校验和一次真实 GPU 应用，不表示在所有模型上视觉正确。

### 6.3 草稿创建

| 入口 | 草稿行为 |
|---|---|
| 空模板 | 新建`state=draft`资产，`source.kind=blank` |
| 内置图“复制并编辑” | 新建 ID，复制图与元数据，`source.kind=builtin-copy` |
| 已可应用本地图“编辑图” | 新建 ID，复制图与元数据，`source.kind=local-copy` |
| 继续已有草稿 | 原 ID 继续编辑，不再复制 |
| JSON 导入 | 新建 ID，`source.kind=json-import` |

这样可以保证编辑过程不改变旧资产及其跨模型引用。

### 6.4 收藏类型

```ts
export type RezeShaderFavoriteV1 = {
  userId: string;
  graphRef: RezeShaderGraphRef;
  createdAt: string;
};
```

收藏不写入资产本体，因而内置图和本地图使用同一机制。

## 7. JSON 导入与导出

### 7.1 标准导出包

```ts
export type RezeShaderGraphExportV1 = {
  schema: "reze-shader-export";
  version: 1;

  name: {
    zh: string;
    en: string;
  };

  graph: ShaderGraph;
  renderClass: RezeShaderRenderClass;
  alphaMode: RezeShaderAlphaMode;
  recommendedGroups: RezeMaterialStyleGroupId[];
  tags: string[];
  description: string;

  source?: {
    graphRef?: RezeShaderGraphRef;
  };
};
```

导出包不包含：

- `userId`；
- 本地资产 `id`；
- 收藏状态；
- `state`；
- IndexedDB 键；
- 场景引用列表；
- 创建和更新时间。

导入标准包时始终生成新的本地图 ID，避免覆盖同名或同 ID 资产。

### 7.2 纯 `ShaderGraph`兼容导入

若 JSON 根对象满足当前 `ShaderGraph`基本形态，但没有`schema: "reze-shader-export"`：

- 作为旧纯图导入；
- `name.zh`使用`graph.name`；
- `name.en`为空；
- `renderClass`设为`auto`；
- `alphaMode`设为`opaque`；
- `recommendedGroups`为空；
- `tags`从`graph.tags`初始化；
- `description`为空；
- 导入结果为`state=draft`；
- UI 必须提示默认元数据并提供修改入口。

### 7.3 导入失败

以下情况必须拒绝导入且不写 IndexedDB：

- JSON 无法解析；
- 标准包版本未知；
- 图版本未知；
- 图结构校验有错误；
- `renderClass`或`alphaMode`不在固定枚举；
- 本地图 ID、用户 ID 或外部存储键试图覆盖当前仓储记录。

导入时的警告可以保存草稿，但错误不能保存。

## 8. 异步应用接口

### 8.1 目标

```ts
export type RezeShaderApplyTarget =
  | {
      kind: "style-group";
      groupId: RezeMaterialStyleGroupId;
      displayName: string;
    }
  | {
      kind: "material";
      materialKey: RezeMaterialKey;
      groupId: RezeMaterialStyleGroupId;
      displayName: string;
    };
```

`displayName`只用于本次反馈，不持久化。

### 8.2 已解析图

```ts
export type ResolvedRezeShaderGraph = {
  graphRef: RezeShaderGraphRef;
  displayName: string;
  graph: ShaderGraph;
  renderClass: RezeShaderRenderClass;
  alphaMode: RezeShaderAlphaMode;
};
```

仓储层负责把图引用解析成完整图；舞台运行时不得直接访问 IndexedDB。

### 8.3 请求

```ts
export type RezeShaderApplyRequest = {
  requestId: string;
  generation: number;
  mode: "preview" | "commit";

  sceneIdentity: {
    userId: string;
    modelPath: string;
    pipeline: "reze-design" | "reze-k3";
  };

  target: RezeShaderApplyTarget;
  shader: ResolvedRezeShaderGraph;
};
```

`generation`按目标单独递增。目标键定义为：

```text
style-group:<groupId>
material:<materialKey>
```

### 8.4 诊断

```ts
export type RezeShaderDiagnostic = {
  severity: "error" | "warning";
  phase: "graph" | "wgsl" | "pipeline" | "target" | "storage";
  nodeId?: string;
  message: string;
};
```

引擎 `Diagnostic`映射规则：

- `validateGraph()`和`compileGraph()`错误 → `graph`；
- WebGPU 着色器模块编译信息 → `wgsl`；
- WebGPU 管线创建失败 → `pipeline`；
- 模型、组或材质不存在 → `target`；
- IndexedDB 或 localStorage 提交失败 → `storage`。

### 8.5 结果

```ts
export type RezeShaderApplyResult =
  | {
      status: "success";
      requestId: string;
      generation: number;
      target: RezeShaderApplyTarget;
      graphRef: RezeShaderGraphRef;
      diagnostics: RezeShaderDiagnostic[];
    }
  | {
      status: "failed";
      requestId: string;
      generation: number;
      target: RezeShaderApplyTarget;
      diagnostics: RezeShaderDiagnostic[];
    }
  | {
      status: "superseded";
      requestId: string;
      generation: number;
      target: RezeShaderApplyTarget;
      diagnostics: RezeShaderDiagnostic[];
    }
  | {
      status: "target-lost";
      requestId: string;
      generation: number;
      target: RezeShaderApplyTarget;
      diagnostics: RezeShaderDiagnostic[];
    };
```

未来舞台句柄的规范接口为：

```ts
applyRezeShader(
  request: RezeShaderApplyRequest,
): Promise<RezeShaderApplyResult>;
```

旧同步 `setMaterialPreset(): object | null`不能继续承担新工作流的提交语义。

### 8.6 原子提交规则

`mode=preview`：

- 成功时只更新临时舞台预览和编辑器会话的“最后成功预览”；
- 不更新正式勾选；
- 不更新场景文档；
- 关闭未应用时恢复进入编辑器前的正式绑定。

`mode=commit`：

- 引擎成功、世代仍为最新、场景身份仍匹配、目标仍存在时，先写入场景文档；
- 场景文档写入成功后，才更新正式勾选并把本次引擎安装视为正式绑定；
- UI 与场景文档提交必须基于同一结果对象；
- localStorage 写入失败时，必须重新应用事务开始前的正式图作为回滚，返回存储诊断，界面不得显示提交成功；
- 本地图草稿只有在舞台成功后才转为`ready`。

编译失败、持久化失败、被取代或目标丢失：

- 旧的正式图继续渲染或被显式恢复；
- 不更新正式勾选；
- 不更新场景文档；
- 不把草稿改为`ready`。

## 9. 引擎样式组映射

场景层类别与引擎 `StyleGroup`不是一一等价的持久对象。运行时适配器按最终绑定生成：

1. 每个类别最多一个基线引擎组，包含该类别中没有单材质图覆盖的材质；
2. 每个单材质图覆盖一个独立引擎组，只包含该材质；
3. 未分组且没有显式基线、没有单材质覆盖的材质不声明引擎组，使用中性回退；
4. 人工移动只改变基线组成员；单材质覆盖组不变；
5. 同一材质最多出现在一个引擎组中；
6. 引擎组 ID 是运行时实现细节，不写入场景或图资产；
7. 引擎组 ID 必须符合`/^[a-z0-9_-]+$/`。

完整组集合变更时，适配器必须避免先删除旧成功安装再暴露编译失败。新增或改变图优先使用可回退的单组安装；只有全部必要候选成功后才提交成员关系。

## 10. 自动分类

自动分类输入至少包含材质名称、网格名称和当前引擎预设提示的规范化小写文本。

第一版匹配优先级：

1. `eye`
2. `stockings`
3. `metal`
4. `face`
5. `hair`
6. `body`
7. `cloth_rough`
8. `cloth_smooth`
9. `default`

无法匹配时进入`ungrouped`，不能用`default`掩盖未知语义。

`stocking`、`socks`、`tights`、`丝袜`、`袜`等提示必须在 body/skin 之前判断。

自动分类函数必须是纯函数，并与 UI 样式组构建、v2 解析和测试共用。

## 11. 图库上下文

```ts
export type RezeShaderLibraryContext = {
  sceneIdentity: RezeShaderApplyRequest["sceneIdentity"];
  target: RezeShaderApplyTarget;
  openedAt: string;
};
```

规则：

- 图库打开后 `target`锁定；
- 浏览卡片、筛选和查看详情不得修改 `target`；
- 显式切换目标时创建新的上下文；
- 模型、管线或当前材质变化导致目标不再存在时，图库关闭或进入不可应用状态；
- 应用按钮必须由 `target`生成完整文案。

## 12. 节点编辑器会话

```ts
export type RezeShaderEditorSession = {
  sessionId: string;
  sceneIdentity: RezeShaderApplyRequest["sceneIdentity"];
  target: RezeShaderApplyTarget;
  draftRef: `local:${string}`;
  restoreGraphRef: RezeShaderGraphRef | null;
  lastSuccessfulPreviewRef: RezeShaderGraphRef | null;
  livePreviewEnabled: boolean;
  dirty: boolean;
  openedAt: string;
};
```

规则：

- `draftRef`必须指向当前用户的`state=draft`资产；
- `restoreGraphRef`记录进入编辑器时目标的正式有效图；未分组中性回退可为`null`；
- 编辑操作只修改草稿；
- 300ms 无新编辑后运行图校验；
- 校验成功才发起`mode=preview`；
- 编译失败保留`lastSuccessfulPreviewRef`对应画面；
- 关闭未应用时应用`restoreGraphRef`的预览恢复，不写场景；
- “应用”成功后把草稿转为`ready`并更新正式绑定；
- “应用并关闭”在同一成功提交后关闭；
- 撤销/重做历史只属于当前编辑会话，不写入场景文档。

## 13. 删除与替代

删除本地图前必须返回：

```ts
export type RezeShaderGraphReference = {
  graphRef: RezeShaderGraphRef;
  pipeline: "reze-design" | "reze-k3";
  modelPath: string;
  target:
    | { kind: "style-group"; groupId: RezeMaterialStyleGroupId }
    | { kind: "material"; materialKey: RezeMaterialKey };
};
```

引用扫描范围：

- 当前用户全部 v2 场景键；
- 当前打开但尚未写入的正式提交事务；
- 当前节点编辑会话的恢复点和目标；
- 当前用户其他草稿的`source.graphRef`只作为来源提示，不阻断删除。

删除规则：

- 无引用时可直接删除资产和收藏记录；
- 有引用时必须选择一个`ready`替代图；
- 替代图不能等于待删除图；
- 替代操作先重写全部可解析场景引用，再删除资产；
- 任一场景无法解析或写入失败时，整个删除操作失败并保留原资产；
- 替代图至少已通过一次真实 GPU 应用，但不承诺所有未加载模型的最终视觉。

## 14. 重置操作矩阵

| 操作 | 组基线 | 单材质图覆盖 | 人工分组覆盖 | 临时显隐 | 场景灯光/相机/背景 |
|---|---:|---:|---:|---:|---:|
| 跟随样式组 | 不变 | 清除当前材质 | 不变 | 不变 | 不变 |
| 重置此材质 | 不变 | 清除当前材质 | 不变 | 恢复当前材质 | 不变 |
| 恢复推荐图 | 清除当前组显式绑定 | 不变 | 不变 | 不变 | 不变 |
| 恢复自动分组 | 不变 | 不变 | 清除当前材质 | 不变 | 不变 |
| 恢复全部默认 | 清除全部 | 清除全部 | 不变 | 全部恢复 | 不变 |

## 15. UI 派生字段

以下字段只由契约数据计算，不持久化：

```ts
export type RezeMaterialBindingView = {
  materialKey: RezeMaterialKey;
  effectiveGroupId: RezeMaterialStyleGroupId;
  effectiveGraphRef: RezeShaderGraphRef | null;
  followsGroup: boolean;
  hasManualGroupOverride: boolean;
};

export type RezeStyleGroupView = {
  groupId: RezeMaterialStyleGroupId;
  effectiveGraphRef: RezeShaderGraphRef | null;
  materialCount: number;
  materialOverrideCount: number;
  hasExplicitGroupBinding: boolean;
};
```

覆盖数量只统计`materialGraphOverrides`，不统计人工分组覆盖。

## 16. 兼容与失败边界

- IndexedDB 不可用时，本地图、收藏和节点草稿功能进入不可用状态；内置图和场景 v2 仍可工作。不得静默改用未隔离的全局 localStorage 图仓储。
- localStorage 不可写时，允许`preview`临时预览；`commit`必须失败并恢复事务开始前的正式图，不能保留未持久化的正式绑定。
- 图引用无法解析时，舞台保留当前已安装图；场景 UI 显示缺失资产并要求替换，不自动改写为默认图。
- `reze-engine`升级导致图版本、节点类型、`RenderClass`或`AlphaMode`变化时，必须先升级本文契约和迁移，再放开新值。
- 当前系统拓扑文档只描述已经运行的实现。本文在实施完成前不得被写成“当前已支持”。

## 17. 验收 Gate

数据契约 Gate：

- v1→v2 迁移测试全通过；
- 九个内置图清单和元数据与引擎公开导出一致；
- 当前 40 个节点类型全部具有编辑器元数据覆盖；
- 图导入、导出和 IndexedDB 用户隔离测试通过；
- 删除引用保护测试通过；
- 重置操作矩阵测试通过。

异步提交 Gate：

- 编译失败不改变舞台正式图、不写场景；
- 快速连续请求只接受最后一次成功结果；
- 组基线变化不覆盖单材质图覆盖；
- 关闭未应用节点编辑器恢复进入前的正式图；
- localStorage 写入失败不显示完全成功。

发布 Gate：

- `reze-design`与`reze-k3`各有真实 PMX、真实 WebGPU 的生产模式证据；
- 1280×720、窄屏和高度不高于 560px 的交互验收通过；
- 当前系统拓扑、概念文档和术语表与最终实现一致。
