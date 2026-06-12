import {
  resolveOfficialGPTImageQuality,
  resolveOfficialGPTImageSize,
} from './image-size-quality-resolver';
import {
  BLT_GPT_IMAGE_GENERATION_REQUEST_SCHEMA,
  BLT_GPT_IMAGE_EDIT_REQUEST_SCHEMA,
} from './image-request-schemas';
import { parseGPTImageResponse } from './gpt-image-adapter';
import { sendAdapterRequest } from './context';
import { registerModelAdapter } from './registry';
import type {
  ImageGenerationRequest,
  ImageModelAdapter,
} from './types';

type BltResponseFormat = 'url' | 'b64_json';

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

function getResolvedOfficialSize(
  request: ImageGenerationRequest,
  model: string
): string | undefined {
  const requestedSize = getStringParam(request.params, 'size') || request.size;
  return resolveOfficialGPTImageSize(model, requestedSize, request.params);
}

function getRequestedCount(request: ImageGenerationRequest): number | undefined {
  const count =
    getNumberParam(request.params, 'n') ?? getNumberParam(request.params, 'count');

  return count !== undefined && count >= 1 && count <= 10 ? count : undefined;
}

function getResponseFormat(
  request: ImageGenerationRequest
): BltResponseFormat | undefined {
  const responseFormat = getStringParam(request.params, 'response_format');
  return responseFormat === 'url' || responseFormat === 'b64_json'
    ? responseFormat
    : undefined;
}

function buildBltGPTImageRequestBody(
  request: ImageGenerationRequest
): Record<string, unknown> {
  const model = request.model || 'gpt-image-2';
  const body: Record<string, unknown> = {
    model,
    prompt: request.prompt,
  };

  const size = getResolvedOfficialSize(request, model);
  if (size) {
    body.size = size;
  }

  const referenceImages = request.referenceImages || [];
  if (referenceImages.length > 0) {
    body.image = referenceImages;
  }

  const responseFormat = getResponseFormat(request);
  if (responseFormat) {
    body.response_format = responseFormat;
  }

  const quality = resolveOfficialGPTImageQuality(request.params);
  if (quality) {
    body.quality = quality;
  }

  const count = getRequestedCount(request);
  if (typeof count === 'number') {
    body.n = count;
  }

  return body;
}

function resolveBltGPTImagePath(
  context: { binding?: { submitPath?: string } | null }
): string {
  return context.binding?.submitPath || '/images/generations';
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
  return `Blt GPT Image request failed: ${response.status}`;
}

export const bltImageAdapter: ImageModelAdapter = {
  id: 'blt-image-adapter',
  label: 'Blt GPT Image',
  kind: 'image',
  docsUrl: 'https://gpt-best.apifox.cn',
  matchRequestSchemas: [
    BLT_GPT_IMAGE_GENERATION_REQUEST_SCHEMA,
    BLT_GPT_IMAGE_EDIT_REQUEST_SCHEMA,
  ],
  defaultModel: 'gpt-image-2',
  async generateImage(context, request) {
    const response = await sendAdapterRequest(context, {
      path: resolveBltGPTImagePath(context),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildBltGPTImageRequestBody(request)),
    });

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

export function registerBltImageAdapter(): void {
  registerModelAdapter(bltImageAdapter);
}
