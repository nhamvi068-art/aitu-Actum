import {
  resolveOfficialGPTImageQuality,
  resolveOfficialGPTImageSize,
} from './image-size-quality-resolver';
import { parseGPTImageResponse } from './gpt-image-adapter';
import { GPTBEST_GPT_IMAGE_EDIT_REQUEST_SCHEMA } from './image-request-schemas';
import { sendAdapterRequest } from './context';
import { registerModelAdapter } from './registry';
import type {
  AdapterContext,
  ImageGenerationRequest,
  ImageModelAdapter,
} from './types';
import {
  base64ToBlob,
  getFileExtension,
} from '@aitu/utils';

type GptBestResponseFormat = 'url' | 'b64_json';

function getStringParam(
  params: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = params?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getNumberParam(
  params: Record<string, unknown> | undefined,
  key: string
): number | undefined {
  const value = params?.[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function isGPTImageModel(modelId?: string | null): boolean {
  if (!modelId) return false;
  const lower = modelId.toLowerCase();
  return (
    lower.startsWith('gpt-image') ||
    lower === 'chatgpt-image-latest'
  );
}

function isNanoBananaModel(modelId?: string | null): boolean {
  if (!modelId) return false;
  const lower = modelId.toLowerCase();
  return (
    lower.includes('nano-banana') ||
    lower.includes('gemini-2.5-flash-image') ||
    lower.includes('gemini-3-pro-image') ||
    lower.includes('gemini-3.1-flash-image')
  );
}

function isFluxModel(modelId?: string | null): boolean {
  if (!modelId) return false;
  const lower = modelId.toLowerCase();
  return (
    lower.startsWith('flux') ||
    lower.includes('flux-kontext')
  );
}

const ASPECT_RATIO_TO_SIZE: Record<string, string> = {
  '21:9': '1536x640',
  '16:9': '1360x768',
  '4:3': '1184x880',
  '3:2': '1248x832',
  '1:1': '1024x1024',
  '2:3': '832x1248',
  '3:4': '880x1184',
  '4:5': '912x1152',
  '5:4': '1152x912',
  '9:16': '768x1360',
};

function resolveSizeForModel(
  modelId: string | undefined,
  size: string | undefined
): string | undefined {
  if (!size) return undefined;

  const normalizedSize = size.trim().toLowerCase().replace(' ', '');

  if (isGPTImageModel(modelId)) {
    return resolveOfficialGPTImageSize(modelId, size);
  }

  if (isNanoBananaModel(modelId) || isFluxModel(modelId)) {
    if (ASPECT_RATIO_TO_SIZE[normalizedSize]) {
      return ASPECT_RATIO_TO_SIZE[normalizedSize];
    }
    if (/^\d+x\d+$/.test(normalizedSize)) {
      return normalizedSize;
    }
  }

  if (ASPECT_RATIO_TO_SIZE[normalizedSize]) {
    return ASPECT_RATIO_TO_SIZE[normalizedSize];
  }

  if (/^\d+x\d+$/.test(normalizedSize)) {
    return normalizedSize;
  }

  return undefined;
}

function getResponseFormat(
  request: ImageGenerationRequest
): GptBestResponseFormat {
  const responseFormat = getStringParam(request.params, 'response_format');
  return responseFormat === 'b64_json' ? 'b64_json' : 'url';
}

function getRequestedCount(request: ImageGenerationRequest): number | undefined {
  const count =
    getNumberParam(request.params, 'n') ??
    getNumberParam(request.params, 'count');
  return count !== undefined && count >= 1 && count <= 10 ? count : undefined;
}

function isEditMode(request: ImageGenerationRequest): boolean {
  const mode = request.generationMode;
  const hasReference =
    !!(request.referenceImages && request.referenceImages.length > 0);
  return mode === 'image_edit' || mode === 'image_to_image' || hasReference;
}

async function imageInputToBlob(
  value: string,
  filenamePrefix: string
): Promise<{ blob: Blob; filename: string }> {
  const mimeType = 'image/png';

  if (value.startsWith('data:')) {
    const blob = base64ToBlob(value);
    const ext = getFileExtension(value, mimeType);
    return {
      blob,
      filename: `${filenamePrefix}.${ext || 'png'}`,
    };
  }

  const response = await fetch(value);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
  }
  const blob = await response.blob();
  const ext = getFileExtension(value, blob.type || mimeType);
  return {
    blob,
    filename: `${filenamePrefix}.${ext || 'png'}`,
  };
}

async function buildGptBestEditFormData(
  request: ImageGenerationRequest
): Promise<FormData> {
  const model = request.model || 'gpt-image-1';
  const referenceImages = request.referenceImages || [];

  const formData = new FormData();
  formData.append('model', model);
  formData.append('prompt', request.prompt);

  const responseFormat = getResponseFormat(request);
  formData.append('response_format', responseFormat);

  const size = resolveSizeForModel(model, getStringParam(request.params, 'size') || request.size);
  if (size) {
    formData.append('size', size);
  }

  const n = getRequestedCount(request);
  if (n !== undefined) {
    formData.append('n', String(n));
  }

  const quality = resolveOfficialGPTImageQuality(request.params);
  if (quality) {
    formData.append('quality', quality);
  }

  for (let i = 0; i < referenceImages.length; i++) {
    const { blob, filename } = await imageInputToBlob(
      referenceImages[i]!,
      `image-${i + 1}`
    );
    formData.append('image', blob, filename);
  }

  return formData;
}

function buildGptBestGenerationBody(
  request: ImageGenerationRequest
): Record<string, unknown> {
  const model = request.model || 'nano-banana';
  const body: Record<string, unknown> = {
    model,
    prompt: request.prompt,
    response_format: getResponseFormat(request),
  };

  const size = resolveSizeForModel(
    model,
    getStringParam(request.params, 'size') || request.size
  );
  if (size) {
    body.size = size;
  }

  const aspectRatio = getStringParam(request.params, 'aspect_ratio');
  if (aspectRatio) {
    body.aspect_ratio = aspectRatio;
  }

  if (
    request.referenceImages &&
    request.referenceImages.length > 0
  ) {
    body.image = request.referenceImages;
  }

  const n = getRequestedCount(request);
  if (n !== undefined) {
    body.n = n;
  }

  const quality = resolveOfficialGPTImageQuality(request.params);
  if (quality) {
    body.quality = quality;
  }

  return body;
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
  if (typeof data?.msg === 'string') {
    return data.msg;
  }
  return `GptBest API request failed: ${response.status}`;
}

function resolveGptBestPath(
  context: { binding?: { submitPath?: string } | null },
  isEdit: boolean
): string {
  if (context.binding?.submitPath) {
    return context.binding.submitPath;
  }
  return isEdit ? '/images/edits' : '/images/generations';
}

export const gptBestImageAdapter: ImageModelAdapter = {
  id: 'gptbest-image-adapter',
  label: 'GptBest Image',
  kind: 'image',
  docsUrl: 'https://gpt-best.apifox.cn',
  matchRequestSchemas: [
    'gptbest.image.gpt-generation-json',
    GPTBEST_GPT_IMAGE_EDIT_REQUEST_SCHEMA,
  ],
  defaultModel: 'nano-banana',
  async generateImage(context, request) {
    const editMode = isEditMode(request);
    const isEditRequest =
      context.binding?.submitPath?.includes('/edits') === true ||
      editMode;

    let response: Response;

    if (isEditRequest) {
      const formData = await buildGptBestEditFormData(request);
      response = await sendAdapterRequest(context, {
        path: resolveGptBestPath(context, true),
        method: 'POST',
        body: formData,
      });
    } else {
      response = await sendAdapterRequest(context, {
        path: resolveGptBestPath(context, false),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildGptBestGenerationBody(request)),
      });
    }

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const result = await response.json();
    const responseFormat = getResponseFormat(request);

    return parseGPTImageResponse(
      result,
      responseFormat === 'b64_json' ? 'png' : undefined
    );
  },
};

export const registerGptBestImageAdapter = (): void => {
  registerModelAdapter(gptBestImageAdapter);
};
