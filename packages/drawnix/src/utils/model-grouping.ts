/**
 * 模型分组工具
 *
 * 将模型列表按 供应商(Provider) → 厂商分类(Vendor) → 具体模型 三级结构分组
 * 无 sourceProfileId 的内置模型直接过滤，不归入任何分组
 */

import type { ModelConfig, ModelVendor } from '../constants/model-config';
import {
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
  TUZI_PROVIDER_ICON_URL,
  type ProviderProfile,
} from './settings-manager';
import {
  DISCOVERY_VENDOR_ORDER,
  getDiscoveryVendorLabel,
} from '../components/shared/ModelVendorBrand';
import { sortModelsByDisplayPriority } from './model-sort';

export interface VendorCategory {
  vendor: ModelVendor;
  label: string;
  models: ModelConfig[];
}

export interface ProviderGroup {
  providerId: string;
  providerName: string;
  providerIconUrl?: string;
  vendorCategories: VendorCategory[];
  totalCount: number;
}

/** 内置模型的默认供应商 ID（保留用于 fallback，不参与分组） */
export const DEFAULT_PROVIDER_ID = LEGACY_DEFAULT_PROVIDER_PROFILE_ID;

/**
 * 返回模型的 providerId，无 sourceProfileId 时返回 null（内置模型不参与分组）
 */
function normalizeProviderId(model: ModelConfig): string | null {
  if (!model.sourceProfileId) {
    return null;
  }
  return model.sourceProfileId;
}

/**
 * 按供应商 → 厂商分类 → 模型 三级分组
 * 无 sourceProfileId 的内置模型被过滤，不出现在任何分组中
 */
export function groupModelsByProvider(
  models: ModelConfig[],
  providerProfiles: ProviderProfile[]
): ProviderGroup[] {
  const profileMap = new Map(providerProfiles.map((p) => [p.id, p]));
  const seen = new Set<string>();

  // 按 provider 分桶，无 providerId 的内置模型跳过
  const buckets = new Map<string, ModelConfig[]>();
  for (const model of models) {
    const pid = normalizeProviderId(model);
    if (pid === null) continue;
    const dedupeKey = `${pid}::${model.type}::${model.id}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    const list = buckets.get(pid);
    if (list) {
      list.push(model);
    } else {
      buckets.set(pid, [model]);
    }
  }

  // vendor 排序权重
  const vendorPriority = new Map(
    DISCOVERY_VENDOR_ORDER.map((v, i) => [v, i])
  );

  const groups: ProviderGroup[] = [];

  for (const [pid, bucket] of buckets) {
    // 按 vendor 分组
    const vendorMap = new Map<ModelVendor, ModelConfig[]>();
    for (const m of bucket) {
      const list = vendorMap.get(m.vendor);
      if (list) {
        list.push(m);
      } else {
        vendorMap.set(m.vendor, [m]);
      }
    }

    const vendorCategories: VendorCategory[] = Array.from(
      vendorMap.entries()
    )
      .sort(
        (a, b) =>
          (vendorPriority.get(a[0]) ?? 999) -
          (vendorPriority.get(b[0]) ?? 999)
      )
      .map(([vendor, vendorModels]) => ({
        vendor,
        label: getDiscoveryVendorLabel(vendor),
        models: sortModelsByDisplayPriority(vendorModels),
      }));

    const profile = profileMap.get(pid);

    groups.push({
      providerId: pid,
      providerName: profile?.name || pid,
      providerIconUrl: profile?.iconUrl,
      vendorCategories,
      totalCount: bucket.length,
    });
  }

  // 按供应商名称排序
  groups.sort((a, b) => a.providerName.localeCompare(b.providerName));

  return groups;
}
