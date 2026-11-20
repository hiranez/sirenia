import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import mermaid from 'mermaid';
import type { AsyncIconLoader } from 'mermaid';
import { downloadSecureImage, warmUpRenderer, ExportError } from '../services/api';
import { isPng, readPngText, MAX_SOURCE_LENGTH, SOURCE_KEYS } from '../utils/pngMetadata';
import { branding } from '../branding';
import { composeFooterNotice, fetchPack, loadPackIndex, type PackEntry } from '../utils/iconPacks';
import { insertIcon, type CatalogEntry } from '../utils/iconPicker';
import IconPicker from './IconPicker';
import '../index.css'; // Ensure styles are loaded

// Example diagrams for quick start. `requiresPack`: shown only when that icon pack is installed.
const EXAMPLES: { name: string; code: string; requiresPack?: string }[] = [
    { 
        name: 'Simple Flowchart', 
        code: `graph TD;
  A[Start] --> B[Process];
  B --> C{Decision};
  C -->|Yes| D[End];
  C -->|No| B;` 
    },
    { 
        name: 'Sequence Diagram', 
        code: `sequenceDiagram
  Alice->>Bob: Hello Bob!
  Bob-->>Alice: Hi Alice!
  Alice->>John: Hello John!` 
    },
    { 
        name: 'Class Diagram', 
        code: `classDiagram
  Animal <|-- Duck
  Animal <|-- Fish
  Animal : +int age
  Animal : +String name` 
    },
    { 
        name: 'Gantt Chart', 
        code: `gantt
  title Project Timeline
  section Planning
  Research :a1, 2024-01-01, 30d
  Design :a2, after a1, 20d` 
    },
    {
        name: 'Google Cloud Architecture',
        requiresPack: 'gcp',
        code: `architecture-beta
  group gcp(cloud)[Google Cloud project]
  group vpc(gcp:vpc)[VPC] in gcp
  service lb(gcp:cloud-load-balancing)[Cloud Load Balancing] in gcp
  service run(gcp:cloud-run)[Cloud Run] in vpc
  service sql(gcp:cloud-sql)[Cloud SQL] in vpc
  service bq(gcp:bigquery)[BigQuery] in gcp
  service gcs(gcp:cloud-storage)[Cloud Storage] in gcp
  lb:R --> L:run
  run:R --> L:sql
  run:B --> T:bq
  bq:R --> L:gcs`
    }
];

type ExportState =
    | { phase: 'idle' }
    | { phase: 'working' }
    | { phase: 'done'; filename: string }
    | { phase: 'error'; message: string; requestId?: string; retryable: boolean };

// The render engine scales to zero when nobody uses it and is shut down after about 15 idle
// minutes, so a "ready" answer is only trusted for a while.
const ENGINE_WARM_TTL_MS = 10 * 60 * 1000;
const ENGINE_RETRY_MS = 30 * 1000; // wait before pinging again after a ping that found it down
// Typical export times, used only to pace the progress bar: a few seconds when the engine is up,
// 10-15 s when it has to start first.
const EXPECTED_SECONDS = { ready: 4, cold: 14 };
// Exports are far smaller; anything bigger is refused before it is read into memory.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// There is no real progress signal from the server, so the bar eases towards (never reaches) the
// end: quick at first, slower the longer it takes. It completes when the file arrives.
const exportProgress = (elapsedSeconds: number, expectedSeconds: number): number =>
    Math.round(92 * (1 - Math.exp((-1.8 * elapsedSeconds) / expectedSeconds)));

const exportMessage = (elapsedSeconds: number): string => {
    if (elapsedSeconds < 4) return 'Rendering your diagram…';
    if (elapsedSeconds < 20) return 'Waking the render engine. The first export after a quiet spell takes about 10–15 seconds.';
    if (elapsedSeconds < 60) return 'Still starting up, which is slower than usual. Your diagram is safe; there is no need to click again.';
    return 'Trying once more. Thank you for your patience.';
};

const DiagramEditor: React.FC = () => {
    const [code, setCode] = useState<string>(
        `graph TD;
  A-->B;
  A-->C;
  B-->D;
  C-->D;`
    );
    const [error, setError] = useState<string | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [downloadFormat, setDownloadFormat] = useState<'png' | 'svg'>('svg');
    const [exportState, setExportState] = useState<ExportState>({ phase: 'idle' });
    const [exportElapsed, setExportElapsed] = useState(0);
    // 'warming' from the first paint: the editor wakes the engine as soon as it loads.
    const [engine, setEngine] = useState<'unknown' | 'warming' | 'ready'>('warming');
    const lastWakeRef = useRef(0);
    const engineExpiryRef = useRef<number | undefined>(undefined);
    const isDownloading = exportState.phase === 'working';
    const [zoom, setZoom] = useState<number>(100);
    // Installed icon packs (from /packs/index.json); null until the index has been read.
    const [packs, setPacks] = useState<PackEntry[] | null>(null);
    const previewRef = useRef<HTMLDivElement>(null);
    const codeRef = useRef<HTMLTextAreaElement>(null);
    // Last caret position in the code field (kept after focus moves to the icon picker); null = none yet.
    const caretRef = useRef<number | null>(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Helper: Break long text in SVG into multiple tspan lines
    const wrapSVGText = (svg: SVGElement, maxCharsPerLine: number = 18) => {
        const textElements = svg.querySelectorAll('text');
        
        textElements.forEach((textEl) => {
            // Get all text content including from tspans
            const originalText = textEl.textContent || '';
            
            // Only process if text is longer than threshold
            if (originalText.length > maxCharsPerLine) {
                // Store original text position attributes
                const x = textEl.getAttribute('x') || '0';
                const startX = textEl.getAttribute('startX') || x;
                
                // Clear all content
                while (textEl.firstChild) {
                    textEl.removeChild(textEl.firstChild);
                }
                
                // Split into words
                const words = originalText.split(/\s+/);
                let currentLine = '';
                let lineCount = 0;
                
                words.forEach((word) => {
                    // Handle long words that exceed maxCharsPerLine by themselves
                    if (word.length > maxCharsPerLine) {
                        // First, save the current line if it exists
                        if (currentLine.trim()) {
                            const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                            tspan.setAttribute('x', startX);
                            if (lineCount > 0) tspan.setAttribute('dy', '1.2em');
                            tspan.textContent = currentLine.trim();
                            textEl.appendChild(tspan);
                            lineCount++;
                            currentLine = '';
                        }
                        
                        // Break the long word into chunks
                        for (let i = 0; i < word.length; i += maxCharsPerLine) {
                            const chunk = word.substring(i, i + maxCharsPerLine);
                            const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                            tspan.setAttribute('x', startX);
                            if (lineCount > 0) tspan.setAttribute('dy', '1.2em');
                            tspan.textContent = chunk;
                            textEl.appendChild(tspan);
                            lineCount++;
                        }
                    } else {
                        // Try to add word to current line
                        const testLine = currentLine ? currentLine + ' ' + word : word;
                        
                        if (testLine.length <= maxCharsPerLine) {
                            currentLine = testLine;
                        } else {
                            // Current line is full, save it and start new line
                            if (currentLine) {
                                const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                                tspan.setAttribute('x', startX);
                                if (lineCount > 0) tspan.setAttribute('dy', '1.2em');
                                tspan.textContent = currentLine;
                                textEl.appendChild(tspan);
                                lineCount++;
                            }
                            currentLine = word;
                        }
                    }
                });
                
                // Add remaining text
                if (currentLine.trim()) {
                    const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                    tspan.setAttribute('x', startX);
                    if (lineCount > 0) tspan.setAttribute('dy', '1.2em');
                    tspan.textContent = currentLine.trim();
                    textEl.appendChild(tspan);
                }
            }
        });
    };

    // Initialize Mermaid once
    useEffect(() => {
        const config: any = {
            startOnLoad: false,
            // 'strict' hardens rendering of untrusted diagrams (e.g. code extracted from an
            // uploaded export via "Restore from Exported SVG or PNG"): no HTML in labels, no click bindings.
            securityLevel: 'strict',
            // Root-level switch, as in the render backend: labels are SVG text, so the preview
            // matches the export. The per-diagram htmlLabels settings below do not turn HTML
            // labels off on their own in Mermaid 11.
            htmlLabels: false,
            // Same list as the render backend: a diagram cannot switch its labels back to HTML
            // with an init directive or front matter.
            secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'htmlLabels'],
            logLevel: 'error',
            // Key change: Let Mermaid calculate everything naturally
            // useMaxWidth: false prevents Mermaid from constraining to viewport
            flowchart: {
                useMaxWidth: false,
                htmlLabels: false,  // Use SVG text instead of HTML - works better with tspans
                curve: 'linear',
                nodeSpacing: 150,   // Much more space between nodes vertically
                rankSpacing: 150,   // Much more space between ranks horizontally
                padding: 40,        // Large padding inside shapes for text
            },
            sequence: {
                useMaxWidth: false,
            },
            gantt: {
                useMaxWidth: false,
            },
            classDiagram: {
                useMaxWidth: false,
                htmlLabels: false,  // Use SVG text instead of HTML
                padding: 40,
            },
            stateDiagram: {
                useMaxWidth: false,
            },
            state: {
                useMaxWidth: false,
            },
            architecture: {
                useMaxWidth: false,
            },
            // Apply to all diagram types
            pie: {
                useMaxWidth: false,
            },
            graph: {
                useMaxWidth: false,
            },
            themeVariables: {
                fontSize: '16px',
                messageFontSize: '16px',
                actorFontSize: '18px',
                noteFontSize: '16px',
            },
        };
        // Icon packs are registered by the effect below, once the pack index has been read.
        mermaid.initialize(config);
        
        // Cleanup interval: Remove any error SVGs that Mermaid renders
        const cleanupInterval = setInterval(() => {
            document.querySelectorAll('svg').forEach((svg) => {
                const text = svg.textContent || '';
                // Remove error visualization SVGs
                if (text.includes('Syntax error') || text.includes('Parse error') || text.includes('mermaid version')) {
                    // Only remove if it's not our main diagram
                    if (svg.closest('.mermaid-preview') === null) {
                        svg.parentElement?.removeChild(svg);
                    }
                }
            });
        }, 2000);
        
        return () => clearInterval(cleanupInterval);
    }, []);

    // Icon packs installed next to the editor (/packs/ on this origin; the render backend reads the
    // same packs from its own directory). Each is registered with a lazy loader, so a pack file is
    // only fetched when a diagram references its prefix. No index means no packs, not an error.
    // Setting the state re-renders the current diagram once (it is a dependency of the render
    // effect), so icons drawn before the index arrived do not stay as "?" placeholders.
    useEffect(() => {
        let active = true;
        void loadPackIndex().then((entries) => {
            if (!active) return;
            mermaid.registerIconPacks(entries.map((entry) => ({
                name: entry.prefix,
                loader: () => fetchPack(entry) as ReturnType<AsyncIconLoader['loader']>,
            })));
            setPacks(entries);
        });
        return () => { active = false; };
    }, []);

    // Render diagram when code changes
    useEffect(() => {
        const render = async () => {
            try {
                if (!previewRef.current) {
                    console.error('[ERROR] Preview ref is null!');
                    return;
                }

                // Clear any previous content
                previewRef.current.innerHTML = '';
                
                // Create unique ID (no dots - invalid for CSS selectors)
                const id = `mermaid-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
                
                // Try to render
                const result = await mermaid.render(id, code);
                
                // Inject SVG
                previewRef.current.innerHTML = result.svg;
                
                // Verify and measure SVG
                const svgInDOM = previewRef.current.querySelector('svg');
                
                if (svgInDOM) {
                    // Apply text wrapping to long text elements
                    wrapSVGText(svgInDOM, 14); // Max 14 chars per line - more aggressive wrapping
                    
                    // Wait for DOM reflow BEFORE measuring (critical!)
                    await new Promise(resolve => {
                        requestAnimationFrame(() => {
                            // Force reflow
                            void svgInDOM.getBBox();
                            resolve(undefined);
                        });
                    });
                    
                    // NOW measure the actual rendered dimensions after text wrapping
                    const bbox = svgInDOM.getBBox();
                    const rect = svgInDOM.getBoundingClientRect();
                    
                    // Update viewBox based on actual content dimensions
                    const padding = 10;
                    const newViewBox = `${bbox.x - padding} ${bbox.y - padding} ${bbox.width + padding * 2} ${bbox.height + padding * 2}`;
                    svgInDOM.setAttribute('viewBox', newViewBox);
                    
                    // Set width/height for proper display
                    const displayWidth = Math.max(bbox.width + padding * 2, 400);
                    const displayHeight = Math.max(bbox.height + padding * 2, 300);
                    svgInDOM.setAttribute('width', String(displayWidth));
                    svgInDOM.setAttribute('height', String(displayHeight));
                    
                    // Ensure SVG has proper viewBox for responsive scaling
                    if (!svgInDOM.getAttribute('viewBox')) {
                        const viewBoxValue = `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`;
                        svgInDOM.setAttribute('viewBox', viewBoxValue);
                    }
                    
                    // Ensure width/height are set for initial display
                    if (!svgInDOM.getAttribute('width')) {
                        svgInDOM.setAttribute('width', String(Math.ceil(rect.width || 800)));
                    }
                    if (!svgInDOM.getAttribute('height')) {
                        svgInDOM.setAttribute('height', String(Math.ceil(rect.height || 600)));
                    }
                    
                    // Remove any inline styling that might constrain size
                    svgInDOM.style.maxWidth = 'none';
                    svgInDOM.style.maxHeight = 'none';
                    svgInDOM.style.width = 'auto';
                    svgInDOM.style.height = 'auto';
                } else {
                    console.warn('[WARNING] No SVG found in rendered content!');
                }
                
                setError(null);
            } catch (e) {
                console.error('[DIAGRAM RENDER FAILED]', e);
                const errMsg = e instanceof Error ? e.message : String(e);
                
                // Set error state
                if (errMsg.includes('syntax')) {
                    setError('❌ Mermaid syntax error. Check your diagram code or try a simpler example.');
                } else {
                    setError(`❌ Rendering failed: ${errMsg}`);
                }
                
                // Show error UI
                if (previewRef.current) {
                    // The message echoes user-supplied diagram text (possibly restored from an uploaded
                    // SVG), so render it as text, never as HTML.
                    previewRef.current.innerHTML = '';
                    const box = document.createElement('div');
                    box.style.cssText = 'color:#cc0000;padding:40px 20px;text-align:center;font-size:14px;white-space:pre-wrap;';
                    const strong = document.createElement('strong');
                    strong.textContent = 'Error:';
                    box.append(strong, document.createElement('br'), document.createTextNode(errMsg));
                    previewRef.current.appendChild(box);
                }
                
                // Remove any error SVGs from document
                document.querySelectorAll('svg').forEach((svg) => {
                    const text = svg.textContent || '';
                    if (text.includes('Syntax error') || text.includes('Parse error')) {
                        svg.parentElement?.removeChild(svg);
                    }
                });
            }
        };

        // Debounce render
        const timer = setTimeout(() => {
            render();
        }, 500);

        return () => clearTimeout(timer);
    }, [code, packs]);

    const markEngine = (ready: boolean) => {
        window.clearTimeout(engineExpiryRef.current);
        setEngine(ready ? 'ready' : 'unknown');
        if (ready) {
            engineExpiryRef.current = window.setTimeout(() => setEngine('unknown'), ENGINE_WARM_TTL_MS);
        }
    };

    // Wake the render engine while the user is still writing, so the wait for the first export
    // mostly happens before they ask for it. At most one ping per TTL (sooner after a failed one).
    // Returns whether a ping was sent.
    const wakeEngine = (): boolean => {
        const now = Date.now();
        if (now - lastWakeRef.current < ENGINE_WARM_TTL_MS) return false;
        lastWakeRef.current = now;
        void warmUpRenderer().then((ready) => {
            if (!ready) lastWakeRef.current = Date.now() - ENGINE_WARM_TTL_MS + ENGINE_RETRY_MS;
            markEngine(ready);
        });
        return true;
    };

    useEffect(() => {
        wakeEngine();
        return () => window.clearTimeout(engineExpiryRef.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
    }, []);

    const editCode = (next: string) => {
        setCode(next);
        if (wakeEngine() && engine !== 'ready') {
            setEngine('warming');
        }
    };

    // Setting the text moves the caret to the end of the field; put it back where the icon was added.
    useLayoutEffect(() => {
        const field = codeRef.current;
        if (field && caretRef.current !== null && document.activeElement !== field) {
            field.setSelectionRange(caretRef.current, caretRef.current);
        }
    }, [code]);

    const insertPackIcon = (prefix: string, entry: CatalogEntry): boolean => {
        const result = insertIcon(code, caretRef.current, prefix, entry);
        if (!result) return false;
        caretRef.current = result.cursor;
        editCode(result.code);
        return true;
    };

    const closePicker = () => {
        setPickerOpen(false);
        const field = codeRef.current;
        if (!field) return;
        field.focus();
        if (caretRef.current !== null) {
            const at = Math.min(caretRef.current, field.value.length);
            field.setSelectionRange(at, at);
        }
    };

    // Tick the elapsed time while an export is running (drives the progress bar and its message).
    useEffect(() => {
        if (exportState.phase !== 'working') return;
        const startedAt = Date.now();
        const tick = window.setInterval(() => setExportElapsed((Date.now() - startedAt) / 1000), 250);
        return () => window.clearInterval(tick);
    }, [exportState.phase]);

    // Let the "downloaded" confirmation fade by itself.
    useEffect(() => {
        if (exportState.phase !== 'done') return;
        const hide = window.setTimeout(() => setExportState({ phase: 'idle' }), 5000);
        return () => window.clearTimeout(hide);
    }, [exportState.phase]);

    const handleDownload = async () => {
        setExportElapsed(0);
        setExportState({ phase: 'working' });
        try {
            const filename = await downloadSecureImage(code, downloadFormat);
            setExportState({ phase: 'done', filename });
            markEngine(true);
        } catch (e) {
            const failure = e instanceof ExportError
                ? e
                : new ExportError('The export failed unexpectedly. Please try again.', undefined, undefined, true);
            setExportState({ phase: 'error', message: failure.message, requestId: failure.requestId, retryable: failure.retryable });
        }
    };

    const handleZoom = (direction: 'in' | 'out' | 'reset') => {
        let newZoom = zoom;
        if (direction === 'in') {
            newZoom = Math.min(zoom + 25, 300);
        } else if (direction === 'out') {
            newZoom = Math.max(zoom - 25, 50);
        } else {
            newZoom = 100;
        }
        setZoom(newZoom);
    };

    // Source embedded by the render backend: <svg> … <metadata><SireniaSource>…</SireniaSource></metadata></svg>
    // (<ClonixSource> in files exported before the key was renamed; see SOURCE_KEYS).
    // The file is untrusted. Only that exact place is read (a <metadata> element directly under
    // the root <svg>), never other metadata text, and the result is only ever used as plain text.
    const extractMermaidCodeFromSvgText = (svgText: string): string | null => {
        const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
        const root = doc.documentElement;
        if (!root || root.localName !== 'svg' || doc.querySelector('parsererror')) return null;

        for (const metadata of Array.from(root.children)) {
            if (metadata.localName !== 'metadata') continue;
            for (const child of Array.from(metadata.children)) {
                if (!(SOURCE_KEYS as readonly string[]).includes(child.localName)) continue;
                const text = child.textContent ?? '';
                // Same ceiling as the backend's diagram source limit (and the PNG reader).
                return text.trim() && text.length <= MAX_SOURCE_LENGTH ? text : null;
            }
        }
        return null;
    };

    // Newest key first, then the legacy one.
    const firstPngSource = (bytes: Uint8Array): string | null => {
        for (const key of SOURCE_KEYS) {
            const text = readPngText(bytes, key);
            if (text) return text;
        }
        return null;
    };

    const handleExportUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (file.size > MAX_UPLOAD_BYTES) {
            setUploadError('This file is too large (over 20 MB) to be an export from this tool.');
            event.target.value = '';
            return;
        }

        try {
            // Decide by content, not by file name: PNG signature, otherwise parse as SVG text.
            const bytes = new Uint8Array(await file.arrayBuffer());
            const extracted = isPng(bytes)
                ? firstPngSource(bytes)
                : extractMermaidCodeFromSvgText(new TextDecoder().decode(bytes));
            if (extracted) {
                caretRef.current = null;
                setCode(extracted);
                setUploadError(null);
                setError(null);
            } else {
                setUploadError(`⚠️ No Mermaid metadata found. This file was not created by this tool. Only SVG and PNG files exported from ${branding.productName} contain embedded source code.`);
            }
        } catch (uploadErr) {
            console.error('Upload parse error:', uploadErr);
            setUploadError('Failed to read the file.');
        } finally {
            event.target.value = '';
        }
    };

    // A build with a contact address is a commercial edition and shows its sales copy.
    const commercial = Boolean(branding.contactEmail);

    const installedPacks = packs ?? [];
    const hasPack = (prefix: string) => installedPacks.some((p) => p.prefix === prefix);
    const otherPacks = installedPacks.filter((p) => p.prefix !== 'gcp');
    const examples = EXAMPLES.filter((example) => !example.requiresPack || hasPack(example.requiresPack));
    // One footer paragraph per installed pack that has a notice (vendor wording from the pack,
    // product wording from the branding).
    const packNotices = installedPacks.flatMap((p) => {
        const text = composeFooterNotice(p, branding);
        return text ? [{ prefix: p.prefix, text }] : [];
    });

    return (
        <div className="editor-container">
            <div className="sidebar">
                <div className="brand-block">
                    <h1>{branding.productName}</h1>
                    <p className="tagline">{commercial
                        ? 'Enterprise Mermaid rendering with provenance tracking. Try the API or use the editor below.'
                        : 'Mermaid diagrams as self-contained SVG and PNG files, with the source embedded. Use the editor below or the API.'}</p>
                </div>
                <div className="info-section">
                    <div className="info-header">{commercial ? '🏢 Enterprise Features' : 'Features'}</div>
                    <ul className="info-list">
                        <li><strong>API Access:</strong> POST to /api/generate for programmatic rendering</li>
                        <li><strong>Metadata Injection:</strong> Source code embedded in every export</li>
                        <li><strong>Audit Trail:</strong> Recover original Mermaid from any exported file</li>
                        {hasPack('gcp') && (
                            <li><strong>Google Cloud diagrams:</strong> Official Google Cloud product icons via the <code>gcp:</code> icon pack (see the "Google Cloud Architecture" example)</li>
                        )}
                        {otherPacks.length > 0 && (
                            <li><strong>Icon packs:</strong> {otherPacks.map((p, i) => (
                                <React.Fragment key={p.prefix}>{i > 0 && ', '}{p.label} (<code>{p.prefix}:</code>)</React.Fragment>
                            ))}</li>
                        )}
                        {packs !== null && installedPacks.length === 0 && (
                            <li><strong>Cloud provider icons:</strong> add an icon pack to draw with a vendor's official product icons</li>
                        )}
                        <li><strong>Rate Limited:</strong> 20 req/min{commercial && ' - contact us for enterprise quotas'}</li>
                    </ul>
                    {branding.contactEmail && (
                        <div className="info-warning">
                            <strong>💼 Need higher limits or self-hosting?</strong> Contact us at <a href={`mailto:${branding.contactEmail}`} style={{color: '#4A90E2'}}>{branding.contactEmail}</a> for enterprise licensing.
                        </div>
                    )}
                </div>
                <div className="control-row">
                    <label className="control-label">Quick Start Examples</label>
                    <div className="example-buttons">
                        {examples.map((example) => (
                            <button
                                key={example.name}
                                className="example-btn"
                                onClick={() => { caretRef.current = null; editCode(example.code); }}
                                title={`Load ${example.name} template`}
                            >
                                {example.name}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="control-row">
                    <label className="control-label">Download format</label>
                    <div className="control-group">
                        <label className="radio-pill">
                            <input
                                type="radio"
                                name="format"
                                value="png"
                                checked={downloadFormat === 'png'}
                                onChange={() => setDownloadFormat('png')}
                            />
                            <span>PNG (metadata)</span>
                        </label>
                        <label className="radio-pill">
                            <input
                                type="radio"
                                name="format"
                                value="svg"
                                checked={downloadFormat === 'svg'}
                                onChange={() => setDownloadFormat('svg')}
                            />
                            <span>SVG</span>
                        </label>
                    </div>
                </div>
                {installedPacks.length > 0 && (
                    <div className="code-tools">
                        <button type="button" className="example-btn" onClick={() => setPickerOpen(true)}>Insert icon…</button>
                    </div>
                )}
                <textarea
                    ref={codeRef}
                    className="code-editor"
                    value={code}
                    onChange={(e) => { caretRef.current = e.target.selectionEnd; editCode(e.target.value); }}
                    onSelect={(e) => { caretRef.current = e.currentTarget.selectionEnd; }}
                    placeholder="Enter Mermaid code here..."
                />
                <div className="action-row">
                    <button className="download-btn" onClick={handleDownload} disabled={isDownloading} aria-busy={isDownloading}>
                        {isDownloading ? 'Rendering…' : 'Download Secure Image'}
                    </button>
                    <label className="upload-btn" title="Only works with SVG or PNG files exported from this tool">
                        📤 Restore from Exported SVG or PNG
                        <input type="file" accept=".svg,.png" onChange={handleExportUpload} />
                    </label>
                </div>
                {exportState.phase === 'working' && (
                    <div className="export-status">
                        <div
                            className="export-progress"
                            role="progressbar"
                            aria-label="Export progress"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={exportProgress(exportElapsed, engine === 'ready' ? EXPECTED_SECONDS.ready : EXPECTED_SECONDS.cold)}
                        >
                            <div
                                className="export-progress-fill"
                                style={{ width: `${exportProgress(exportElapsed, engine === 'ready' ? EXPECTED_SECONDS.ready : EXPECTED_SECONDS.cold)}%` }}
                            />
                        </div>
                        <p className="export-message" role="status" aria-live="polite">{exportMessage(exportElapsed)}</p>
                    </div>
                )}
                {exportState.phase === 'done' && (
                    <div className="export-status export-done" role="status">✓ {exportState.filename} downloaded.</div>
                )}
                {exportState.phase === 'error' && (
                    <div className="error-box export-error" role="alert">
                        <span>{exportState.message}</span>
                        {exportState.retryable && (
                            <button className="retry-btn" onClick={handleDownload}>Try again</button>
                        )}
                        {exportState.requestId && (
                            <span className="export-reference">Reference: {exportState.requestId}</span>
                        )}
                    </div>
                )}
                {exportState.phase === 'idle' && engine !== 'unknown' && (
                    <p className={`engine-hint ${engine}`}>
                        {engine === 'ready' ? 'Render engine ready.' : 'Waking the render engine so your first export is quick…'}
                    </p>
                )}
                {error && <div className="error-box">{error}</div>}
                {uploadError && <div className="error-box">{uploadError}</div>}
                <div className="tos-footer">
                    <p><strong>API Documentation:</strong> <code>POST /api/generate</code> with <code>{'{code: "graph TD; A--&gt;B;", output: "png"}'}</code>. Response: image with embedded metadata. Rate limit: 20/min.</p>
                    <p className="tos-privacy">🔒 Privacy: No data stored.{branding.contactEmail && <> Enterprise SLA available. <a href={`mailto:${branding.contactEmail}`} style={{color: '#4A90E2'}}>Contact sales</a>.</>}</p>
                    {packNotices.map(({ prefix, text }) => (
                        <p key={prefix} className="tos-privacy">{text}</p>
                    ))}
                    {branding.basedOn && (
                        <p className="tos-privacy">{branding.productName} is based on <a href={branding.basedOn.url} target="_blank" rel="noopener noreferrer" style={{color: '#4A90E2'}}>{branding.basedOn.name}</a>, an open-source project under the Apache License 2.0.</p>
                    )}
                </div>
            </div>
            {pickerOpen && installedPacks.length > 0 && (
                <IconPicker packs={installedPacks} code={code} onInsert={insertPackIcon} onClose={closePicker} />
            )}
            <div className="preview-container">
                <div className="preview-toolbar">
                    <div className="zoom-controls">
                        <button 
                            className="zoom-btn" 
                            onClick={() => handleZoom('out')}
                            title="Zoom Out (50%-25%)"
                        >
                            −
                        </button>
                        <span className="zoom-display">{zoom}%</span>
                        <button 
                            className="zoom-btn" 
                            onClick={() => handleZoom('in')}
                            title="Zoom In (100%-300%)"
                        >
                            +
                        </button>
                        <button 
                            className="zoom-btn reset" 
                            onClick={() => handleZoom('reset')}
                            title="Reset Zoom to 100%"
                        >
                            ↺
                        </button>
                    </div>
                    <div className="preview-info">
                        {error ? '❌ Error' : '✓ Ready'}
                    </div>
                </div>
                <div className="preview-pane" ref={containerRef}>
                    <div ref={previewRef} className="mermaid-preview" style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left' }} />
                </div>
            </div>
        </div>
    );
};

export default DiagramEditor;
