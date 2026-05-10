import {
  base64ToBlob,
  getFileExtension,
  normalizeImageDataUrl,
} from '@aitu/utils';
import { parseGPTImageResponse } from './gpt-image-adapter';
import { sendAdapterRequest } from './context';
import { registerModelAdapter } from './registry';
import type {
  ImageGenerationRequest,
  ImageModelAdapter,
} from './types';

const NANOBANANA_ASPECT_RATIOS = new Set([
  '4:3',
  '3:4',
  '16:9',
  '9:16',
  '2:3',
  '3:2',
  '1:1',
  '4:5',
  '5:4',
  '21:9',
]);

const NANOBANANA_IMAGE_SIZES = new Set(['1K', '2K', '4K', '512']);

const MODEL_DEFAULT_IMAGE_SIZE: Record<string, string> = {
  'nano-banana-pro': '1K',
  'nano-banana-pro-2k': '2K',
  'nano-banana-pro-4k': '4K',
  'gemini-3.1-flash-image-preview-512px': '512',
  'gemini-3.1-flash-image-preview-2k': '2K',
  'gemini-3.1-flash-image-preview-4k': '4K',
};

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function resolveAspectRatio(size?: string): string | undefined {
  if (!size) return undefined;
  const trimmed = size.trim().toLowerCase();
  if (trimmed === 'auto') return undefined;
  if (NANOBANANA_ASPECT_RATIOS.has(trimmed)) return trimmed;
  if (NANOBANANA_ASPECT_RATIOS.has(size)) return size;
  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) return undefined;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!w || !h) return undefined;
  const g = gcd(w, h);
  const ratio = `${w / g}:${h / g}`;
  return NANOBANANA_ASPECT_RATIOS.has(ratio) ? ratio : undefined;
}

function resolveImageSize(
  model: string,
  params?: Record<string, unknown>
): string | undefined {
  const res = params?.resolution as string | undefined;
  if (res && NANOBANANA_IMAGE_SIZES.has(res)) return res;
  return MODEL_DEFAULT_IMAGE_SIZE[model];
}

function isEditMode(
  submitPath?: string,
  generationMode?: string
): boolean {
  if (submitPath?.includes('/edits')) return true;
  return (
    generationMode === 'image_edit' || generationMode === 'image_to_image'
  );
}

async function buildEditFormData(
  request: ImageGenerationRequest
): Promise<FormData> {
  if (!request.model) {
    throw new Error('Nano-banana 编辑请求缺少模型 ID');
  }

  const referenceImages = request.referenceImages || [];
  if (referenceImages.length === 0) {
    throw new Error('Nano-banana 编辑请求缺少参考图片');
  }

  const formData = new FormData();
  formData.append('model', request.model);
  formData.append('prompt', request.prompt);

  for (let index = 0; index < referenceImages.length; index++) {
    const value = referenceImages[index]!;
    const normalized = normalizeImageDataUrl(value, 'image/png');
    const filename = `image-${index + 1}.png`;

    if (normalized.startsWith('data:')) {
      const blob = base64ToBlob(normalized);
      formData.append('image', blob, filename);
    } else {
      const response = await fetch(normalized);
      if (!response.ok) {
        throw new Error(
          `Nano-banana 参考图读取失败: ${response.status} ${response.statusText}`
        );
      }
      const blob = await response.blob();
      const ext = getFileExtension(filename, blob.type) || 'png';
      formData.append('image', blob, `${index + 1}.${ext}`);
    }
  }

  const aspectRatio = resolveAspectRatio(request.size);
  if (aspectRatio) formData.append('aspect_ratio', aspectRatio);

  const imageSize = resolveImageSize(request.model, request.params);
  if (imageSize) formData.append('image_size', imageSize);

  formData.append('response_format', 'url');

  return formData;
}

async function readErrorMessage(response: Response): Promise<string> {
  const data = await response.json().catch(() => null);
  if (typeof data?.error === 'string') {
    return data.error;
  }
  if (typeof data?.error?.message === 'string') {
    return data.error.message;
  }
  if (typeof data?.message === 'string') {
    return data.message;
  }
  return `Nano-banana request failed: ${response.status}`;
}

export const nanoBananaAdapter: ImageModelAdapter = {
  id: 'nanobanana-image-adapter',
  label: 'Nano-banana Image',
  kind: 'image',
  docsUrl: '',
  matchRequestSchemas: [
    'nanobanana.image.generation-json',
    'nanobanana.image.edit-form',
  ],
  defaultModel: 'nano-banana-pro',
  async generateImage(context, request) {
    const submitPath = context.binding?.submitPath;
    const editMode = isEditMode(submitPath, request.generationMode);

    if (editMode) {
      const formData = await buildEditFormData(request);
      const response = await sendAdapterRequest(context, {
        path: '/images/edits',
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      const result = await response.json();
      return parseGPTImageResponse(result);
    }

    const model = request.model || 'nano-banana-pro';
    const body: Record<string, unknown> = {
      model,
      prompt: request.prompt,
      response_format: 'url',
    };

    const aspectRatio = resolveAspectRatio(request.size);
    if (aspectRatio) body.aspect_ratio = aspectRatio;

    const imageSize = resolveImageSize(model, request.params);
    if (imageSize) body.image_size = imageSize;

    if (request.referenceImages?.length) {
      body.image = request.referenceImages;
    }

    const response = await sendAdapterRequest(context, {
      path: '/images/generations',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }
    const result = await response.json();
    return parseGPTImageResponse(result);
  },
};

export const registerNanoBananaAdapter = (): void => {
  registerModelAdapter(nanoBananaAdapter);
};
