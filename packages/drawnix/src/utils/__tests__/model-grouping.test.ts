import { describe, expect, it } from 'vitest';
import { ModelVendor, type ModelConfig } from '../../constants/model-config';
import { groupModelsByProvider } from '../model-grouping';

const LEGACY_DEFAULT_PROVIDER_PROFILE_ID = 'legacy-default';

describe('model-grouping', () => {
  it('同一 provider 下按 type + id 去重，但保留跨 provider 同名模型', () => {
    const duplicateInDefault: ModelConfig = {
      id: 'gpt-4o-image',
      label: 'GPT-4o Image',
      type: 'image',
      vendor: ModelVendor.GPT,
    };

    const groups = groupModelsByProvider(
      [
        duplicateInDefault,
        {
          ...duplicateInDefault,
          label: 'GPT-4o Image duplicate',
        },
        {
          ...duplicateInDefault,
          sourceProfileId: 'custom-openai',
          sourceProfileName: 'Custom OpenAI',
          selectionKey: 'custom-openai::gpt-4o-image',
        },
      ],
      [
        {
          id: LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
          name: 'default',
          baseUrl: '',
          apiKey: '',
          enabled: true,
          capabilities: {
            text: true,
            image: true,
            video: true,
            audio: false,
          },
        },
        {
          id: 'custom-openai',
          name: 'Custom OpenAI',
          baseUrl: '',
          apiKey: '',
          enabled: true,
          capabilities: {
            text: true,
            image: true,
            video: false,
            audio: false,
          },
        },
      ]
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.providerId).toBe('custom-openai');
    expect(groups[0]?.totalCount).toBe(1);
    expect(groups[0]?.vendorCategories[0]?.models).toHaveLength(1);
  });

  it('无 sourceProfileId 的内置模型不参与分组', () => {
    const builtInModel: ModelConfig = {
      id: 'gpt-image-2-vip',
      label: 'GPT Image 2 VIP',
      type: 'image',
      vendor: ModelVendor.GPT,
    };
    const runtimeModel: ModelConfig = {
      id: 'gpt-image-2-vip',
      label: 'GPT Image 2 VIP',
      type: 'image',
      vendor: ModelVendor.GPT,
      sourceProfileId: 'my-provider',
      sourceProfileName: 'My Provider',
      selectionKey: 'my-provider::gpt-image-2-vip',
    };

    const groups = groupModelsByProvider(
      [builtInModel, runtimeModel],
      [
        {
          id: LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
          name: 'default',
          baseUrl: '',
          apiKey: '',
          enabled: true,
          capabilities: { text: true, image: true, video: true, audio: true },
        },
        {
          id: 'my-provider',
          name: 'My Provider',
          baseUrl: '',
          apiKey: '',
          enabled: true,
          capabilities: { text: true, image: true, video: true, audio: true },
        },
      ]
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.providerId).toBe('my-provider');
    expect(groups[0]?.totalCount).toBe(1);
    expect(groups[0]?.vendorCategories[0]?.models[0]?.id).toBe('gpt-image-2-vip');
    expect(groups[0]?.vendorCategories[0]?.models[0]?.sourceProfileId).toBe('my-provider');
  });
});
