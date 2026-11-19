import axios from 'axios';

// The proxy allows one 60 s attempt plus one retry; give it room before the browser gives up.
const EXPORT_TIMEOUT_MS = 130_000;

/** A failed export, with a message that is safe and useful to show to the user. */
export class ExportError extends Error {
    status: number | undefined;
    requestId: string | undefined;
    /** True when simply trying again is likely to work (the render engine was still starting). */
    retryable: boolean;

    constructor(message: string, status: number | undefined, requestId: string | undefined, retryable: boolean) {
        super(message);
        this.name = 'ExportError';
        this.status = status;
        this.requestId = requestId;
        this.retryable = retryable;
    }
}

// Error responses arrive as a Blob because the request asks for binary data; the services answer
// errors with JSON ({ error, requestId? }), which is where messages such as "Unknown icon(s): ..."
// live. Anything else (an HTML error page from the platform) is ignored.
const readErrorBody = async (data: unknown): Promise<{ error?: string; requestId?: string }> => {
    try {
        const text = data instanceof Blob ? await data.text() : '';
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
            const { error, requestId } = parsed as { error?: unknown; requestId?: unknown };
            return {
                error: typeof error === 'string' ? error : undefined,
                requestId: typeof requestId === 'string' ? requestId : undefined,
            };
        }
    } catch {
        // not JSON: fall through to the generic message for the status
    }
    return {};
};

const toExportError = async (error: unknown): Promise<ExportError> => {
    if (!axios.isAxiosError(error)) {
        return new ExportError('The export failed unexpectedly. Please try again.', undefined, undefined, true);
    }
    const status = error.response?.status;
    if (status === undefined) {
        // No response: offline, connection dropped, or the browser-side timeout fired.
        return new ExportError('Could not reach the export service. Check your connection and try again.', undefined, undefined, true);
    }
    const body = await readErrorBody(error.response?.data);
    const headerId: unknown = error.response?.headers?.['x-request-id'];
    const requestId = body.requestId ?? (typeof headerId === 'string' ? headerId : undefined);

    if (status === 429) {
        return new ExportError('That is a lot of exports in one minute. Please wait a moment and try again.', status, requestId, true);
    }
    if (status === 502 || status === 503 || status === 504) {
        return new ExportError('The render engine did not answer in time. It is usually ready on the next try.', status, requestId, true);
    }
    if (status === 400 && body.error) {
        // Validation messages from the service (syntax error, unknown icon names, size limit).
        return new ExportError(body.error, status, requestId, false);
    }
    return new ExportError(body.error ?? `The export failed (error ${status}). Please try again.`, status, requestId, status >= 500);
};

/**
 * Download the rendered image with embedded metadata. Uses the relative path /api/generate, which
 * the auth proxy in the same container forwards to the backend. Resolves to the file name;
 * rejects with an ExportError.
 */
export const downloadSecureImage = async (code: string, output: 'png' | 'svg'): Promise<string> => {
    try {
        const response = await axios.post('/api/generate', { code, output }, {
            responseType: 'blob',
            timeout: EXPORT_TIMEOUT_MS,
            headers: {
                'Content-Type': 'application/json',
            },
        });

        const filename = `diagram.${output}`;
        const url = window.URL.createObjectURL(new Blob([response.data]));

        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename);

        document.body.appendChild(link);
        link.click();
        link.parentNode?.removeChild(link);
        window.URL.revokeObjectURL(url);
        return filename;
    } catch (error) {
        console.error('Error downloading image:', error);
        throw await toExportError(error);
    }
};

/**
 * Ask the proxy to wake the render engine (it scales to zero when idle). Resolves to whether the
 * engine is up. Never rejects: warming up is an optimisation, not something to bother the user with.
 */
export const warmUpRenderer = async (): Promise<boolean> => {
    try {
        const response = await axios.post('/api/warmup', null, { timeout: 70_000 });
        return (response.data as { ready?: unknown } | null)?.ready === true;
    } catch {
        return false;
    }
};
