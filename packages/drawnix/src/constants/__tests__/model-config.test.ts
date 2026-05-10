import { describe, expect, it } from 'vitest';
import {
  getCompatibleParams,
  getSizeOptionsForModel,
  getStaticModelConfig,
  ModelVendor,
} from '../model-config';

describe('model-config image size options', () => {
  it('Flux 模型使用兜底尺寸参数（无重复）', () => {
    const params = getCompatibleParams('bfl-flux-2-pro');
    const sizeParams = params.filter((p) => p.id === 'size');
    expect(sizeParams).toHaveLength(1);
    // 兜底参数有 defaultValue: '1:1'，且不包含 'auto'（auto 是 Gemini/GPT 专属的）
    expect(sizeParams[0]?.defaultValue).toBe('1:1');
    expect(sizeParams[0]?.options?.map((o) => o.label)).toContain('1:1 方形');
  });

  it('已有专属尺寸的模型不受兜底影响（GPT Image 2）', () => {
    const params = getCompatibleParams('gpt-image-2');
    const sizeParams = params.filter((p) => p.id === 'size');
    expect(sizeParams).toHaveLength(1);
    // GPT Image 2 的专属尺寸选项（带 auto 和 1x1/16x9 等格式）
    expect(sizeParams[0]?.options?.map((o) => o.value)).toEqual([
      'auto',
      '1x1',
      '2x3',
      '3x2',
      '3x4',
      '4x3',
      '4x5',
      '5x4',
      '9x16',
      '16x9',
      '21x9',
    ]);
    expect(sizeParams[0]?.defaultValue).toBe('auto');
  });

  it('Gemini 模型使用其专属尺寸（不受兜底影响）', () => {
    const params = getCompatibleParams('gemini-3-pro-image-preview');
    const sizeParams = params.filter((p) => p.id === 'size');
    expect(sizeParams).toHaveLength(1);
    expect(sizeParams[0]?.defaultValue).toBe('auto');
    expect(sizeParams[0]?.options?.map((o) => o.value)).toContain('auto');
    expect(sizeParams[0]?.options?.map((o) => o.value)).toContain('1x1');
  });

  it('已下架模型仍然返回空（兜底不污染无效模型）', () => {
    // 已下架模型不在 IMAGE_MODELS 中，getModelConfig 返回 undefined
    expect(getCompatibleParams('gpt-image-1')).toEqual([]);
    expect(getCompatibleParams('gpt-image-1.5')).toEqual([]);
  });

  it('getSizeOptionsForModel 为 Flux 返回兜底选项', () => {
    const options = getSizeOptionsForModel('bfl-flux-2-pro');
    // 兜底尺寸：defaultValue 是 '1:1'，不包含 'auto'
    expect(options.find((o) => o.value === '1:1')?.label).toBe('1:1 方形');
    expect(options.some((o) => o.value === 'auto')).toBe(false);
  });
  it('为 gpt-image-2 系列暴露扩展比例', () => {
    const expected = [
      'auto',
      '1x1',
      '2x3',
      '3x2',
      '3x4',
      '4x3',
      '4x5',
      '5x4',
      '9x16',
      '16x9',
      '21x9',
    ];

    expect(
      getSizeOptionsForModel('gpt-image-2').map((option) => option.value)
    ).toEqual(expected);
    expect(
      getSizeOptionsForModel('gpt-image-2-vip').map((option) => option.value)
    ).toEqual(expected);
  });

  it('为 gpt-image-2 暴露分辨率和官方画质参数', () => {
    const params = getCompatibleParams('gpt-image-2');
    const qualityParams = params.filter((param) => param.id === 'quality');

    expect(
      params
        .find((param) => param.id === 'resolution')
        ?.options?.map((option) => option.value)
    ).toEqual(['1k', '2k', '4k']);
    expect(qualityParams).toHaveLength(1);
    expect(qualityParams[0]?.options?.map((option) => option.value)).toEqual([
      'auto',
      'low',
      'medium',
      'high',
    ]);
  });

  it('不再内置已下架的 GPT Image 旧模型', () => {
    expect(getStaticModelConfig('gpt-image-1')).toBeUndefined();
    expect(getStaticModelConfig('gpt-image-1.5')).toBeUndefined();
    expect(getCompatibleParams('gpt-image-1')).toEqual([]);
    expect(getCompatibleParams('gpt-image-1.5')).toEqual([]);
  });

  it('保留 Gemini preview 的旧 quality 档位参数', () => {
    const params = getCompatibleParams('gemini-3-pro-image-preview');
    const qualityParams = params.filter((param) => param.id === 'quality');

    expect(qualityParams).toHaveLength(1);
    expect(qualityParams[0]?.options?.map((option) => option.value)).toEqual([
      '1k',
      '2k',
      '4k',
    ]);
  });

  it('按模型暴露 HappyHorse 参数控制', () => {
    const t2vParams = getCompatibleParams('happyhorse-1.0-t2v');
    const i2vParams = getCompatibleParams('happyhorse-1.0-i2v');
    const r2vParams = getCompatibleParams('happyhorse-1.0-r2v');
    const editParams = getCompatibleParams('happyhorse-1.0-video-edit');

    expect(getSizeOptionsForModel('happyhorse-1.0-r2v')[0]?.value).toBe(
      '1080P'
    );
    expect(
      r2vParams
        .find((param) => param.id === 'duration')
        ?.options?.map((option) => option.value)
    ).toEqual([
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
      '13',
      '14',
      '15',
    ]);
    expect(
      r2vParams
        .find((param) => param.id === 'ratio')
        ?.options?.map((option) => option.value)
    ).toEqual(['16:9', '9:16', '1:1', '4:3', '3:4']);
    expect(i2vParams.some((param) => param.id === 'ratio')).toBe(false);
    expect(editParams.some((param) => param.id === 'duration')).toBe(false);
    expect(editParams.some((param) => param.id === 'ratio')).toBe(false);
    expect(editParams.some((param) => param.id === 'audio_setting')).toBe(true);
    expect(t2vParams.some((param) => param.id === 'ratio')).toBe(true);
    expect(r2vParams.find((param) => param.id === 'seed')).toMatchObject({
      valueType: 'number',
      min: 0,
      max: 2147483647,
    });
    expect(
      r2vParams
        .find((param) => param.id === 'watermark')
        ?.options?.map((option) => option.value)
    ).toEqual(['true', 'false']);
    expect(
      r2vParams.find((param) => param.id === 'watermark')?.defaultValue
    ).toBe(
      'false'
    );
    expect(getStaticModelConfig('happyhorse-1.0-t2v')?.vendor).toBe(
      ModelVendor.HAPPYHORSE
    );
  });
});
