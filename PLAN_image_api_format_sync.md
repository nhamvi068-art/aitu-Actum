# 图片接口格式下拉菜单及路由逻辑同步计划

## 目标

将 **opentu-main** 的图片接口格式下拉菜单配置及底层路由逻辑同步到 **aitu-Actum-main**，使两个项目的"图片接口格式"下拉框完全一致。

---

## 一、差异总览

### 1.1 UI 层（settings-dialog.tsx）

| 差异项 | Actum（当前） | Opentu（目标） |
|--------|--------------|----------------|
| `IMAGE_API_COMPATIBILITY_OPTIONS` | 5 项（含 `nanobanana`） | 4 项 |
| `IMAGE_API_COMPATIBILITY_META['tuzi-gpt-image'].label` | `'Blt GPT 兼容'` | `'Tuzi GPT 兼容'` |
| `normalizeImageApiCompatibilityForDisplay` | 支持 `'nanobanana'` | 不支持 |
| `resolveAutoImageApiCompatibilityForDisplay` | 不存在 | 新增 |
| `getImageApiCompatibilityHint` | 不存在 | 新增 |

### 1.2 类型层（settings-types.ts）

| 差异项 | Actum | Opentu |
|--------|-------|--------|
| `ImageApiCompatibility` 类型 | 5 项（含 `nanobanana`） | 4 项 |

### 1.3 路由推理层（binding-inference.ts）

| 差异项 | Actum | Opentu |
|--------|-------|--------|
| `isGptBestProfile` / `isGptBestBaseUrl` | 有（Actum 特色） | 无 |
| `NANOBANANA_MODEL_IDS` / `isNanoBananaModel` | 有（Actum 特色） | 无 |
| `normalizeImageApiCompatibilityMode` | 支持 `'nanobanana'` | 不支持 |
| `resolveImageApiCompatibility` 中的 `isGptBestProfile` 分支 | 有 | 无 |
| `shouldPreferAsyncImageBinding` | 无 | 有 |
| Async 绑定条件 | `!isMidjourneyModel && isAsyncImageModel` | `shouldPreferAsyncImageBinding` |
| 非 Async 绑定条件 | `!isAsyncImageModel \|\| isSeedreamModel` | `!shouldPreferAsyncImageBinding` |
| NanoBanana 绑定块 | 有 | 无 |

### 1.4 设置管理（settings-manager.ts）

| 差异项 | Actum | Opentu |
|--------|-------|--------|
| `normalizeImageApiCompatibility` | 支持 `'nanobanana'` | 不支持 |

---

## 二、修改计划

### 修改 1：`settings-types.ts` — 移除 `nanobanana` 类型

**文件**: `packages/drawnix/src/utils/settings-types.ts`

```typescript
// Actum 当前（line 16-21）
export type ImageApiCompatibility =
  | 'auto'
  | 'openai-gpt-image'
  | 'tuzi-gpt-image'
  | 'nanobanana'          // ← 删除
  | 'openai-compatible-basic';

// Opentu 目标
export type ImageApiCompatibility =
  | 'auto'
  | 'openai-gpt-image'
  | 'tuzi-gpt-image'
  | 'openai-compatible-basic';
```

---

### 修改 2：`settings-dialog.tsx` — 更新下拉选项和标签

**文件**: `packages/drawnix/src/components/settings-dialog/settings-dialog.tsx`

#### 2a. 移除 `nanobanana` 选项（line 132-138）

#### 2b. 修改标签文字（line 262-264）
- `'tuzi-gpt-image'` 的 label 从 `'Blt GPT 兼容'` 改为 `'Tuzi GPT 兼容'`
- 删除整个 `'nanobanana': { label: 'Nano-banana 图片兼容' }` 条目

#### 2c. 更新 `normalizeImageApiCompatibilityForDisplay`
- 移除 `value === 'nanobanana'` 分支

#### 2d. 新增 `resolveAutoImageApiCompatibilityForDisplay` 函数
```typescript
function resolveAutoImageApiCompatibilityForDisplay(
  profile: Pick<ProviderProfile, 'baseUrl'>
): Exclude<ImageApiCompatibility, 'auto'> {
  const normalizedBaseUrl = profile.baseUrl.trim().toLowerCase();
  if (normalizedBaseUrl.includes('api.openai.com')) {
    return 'openai-gpt-image';
  }
  if (normalizedBaseUrl.includes('.tu-zi.com')) {
    return 'tuzi-gpt-image';
  }
  return 'openai-compatible-basic';
}
```

#### 2e. 新增 `getImageApiCompatibilityHint` 函数
```typescript
function getImageApiCompatibilityHint(
  profile: Pick<ProviderProfile, 'baseUrl' | 'imageApiCompatibility'>
): string {
  const storedCompatibility = normalizeImageApiCompatibilityForDisplay(
    profile.imageApiCompatibility
  );
  if (storedCompatibility === 'auto') {
    const resolvedCompatibility = resolveAutoImageApiCompatibilityForDisplay(profile);
    return `默认推荐显式选择 OpenAI GPT Image；如果保留自动模式，GPT Image 模型当前会解析为 ${IMAGE_API_COMPATIBILITY_META[resolvedCompatibility].label}。`;
  }
  if (storedCompatibility === 'openai-gpt-image') {
    return '默认推荐模式。适用于官方 GPT Image 请求格式，也便于后续继续扩展官方图生图能力。';
  }
  return `同一个图片模型在不同 API Key 或网关下可能需要不同接口格式；当前已固定为 ${IMAGE_API_COMPATIBILITY_META[storedCompatibility].label}。`;
}
```

---

### 修改 3：`binding-inference.ts` — 移除 nanobanana 逻辑

**文件**: `packages/drawnix/src/services/provider-routing/binding-inference.ts`

#### 3a. 移除 nanobanana 相关 imports

#### 3b. 移除 `NANOBANANA_MODEL_IDS` 常量和 `isNanoBananaModel` 函数

#### 3c. 移除 `isGptBestProfile` 和 `isGptBestBaseUrl` 函数

#### 3d. 更新 `normalizeImageApiCompatibilityMode`
- 移除 `'nanobanana'` 分支

#### 3e. 更新 `resolveImageApiCompatibility`
- 移除 `isGptBestProfile` 分支

#### 3f. 新增 `shouldPreferAsyncImageBinding` 函数
```typescript
function shouldPreferAsyncImageBinding(
  profile: ProviderProfileSnapshot,
  model: ModelConfig
): boolean {
  return !!profile.preferAsyncImageEndpoint && model.type === 'image';
}
```

#### 3g. 替换所有 async/非 async 绑定条件
- `!isMidjourneyModel(model) && isAsyncImageModel(model.id)` → `shouldPreferAsyncImageBinding(profile, model)`
- `!isAsyncImageModel(model.id) || isSeedreamModel(model)` → `!shouldPreferAsyncImageBinding(profile, model)`

#### 3h. 移除 NanoBanana 绑定块

---

### 修改 4：`settings-manager.ts` — 移除 nanobanana 逻辑

**文件**: `packages/drawnix/src/utils/settings-manager.ts`

- `normalizeImageApiCompatibility` 方法中移除 `'nanobanana'` 分支

---

## 三、需保留的 Actum 特色代码（不同步）

以下内容属于 Actum 分支的特色功能，**不纳入本次同步**：

1. `nano-banana-adapter.ts` 及其注册逻辑 — Actum 特有适配器
2. `gptbest-image-adapter.ts` — Actum 特有适配器
3. `IMAGE_MODEL_MORE_OPTIONS` 中的 nanobanana 模型配置（model-config.ts）
4. `ASYNC_IMAGE_MODEL_IDS` 中的 nanobanana 相关 ID

---

## 四、修改文件清单

| # | 文件 | 修改内容 |
|---|------|----------|
| 1 | `settings-types.ts` | 移除 `'nanobanana'` 类型 |
| 2 | `settings-dialog.tsx` | 移除 nanobanana 选项；改 label 为 `Tuzi GPT 兼容`；新增 `resolveAutoImageApiCompatibilityForDisplay` 和 `getImageApiCompatibilityHint` |
| 3 | `binding-inference.ts` | 移除 nanobanana/gptbest 相关函数；新增 `shouldPreferAsyncImageBinding`；替换所有 `isAsyncImageModel` 条件 |
| 4 | `settings-manager.ts` | `normalizeImageApiCompatibility` 移除 nanobanana |
