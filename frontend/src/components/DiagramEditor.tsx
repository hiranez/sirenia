import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import mermaid from 'mermaid';
import type { AsyncIconLoader } from 'mermaid';
import { downloadSecureImage, warmUpRenderer, ExportError } from '../services/api';
import { isPng, readPngText, MAX_SOURCE_LENGTH, SOURCE_KEYS } from '../utils/pngMetadata';
import { branding } from '../branding';
import { composeFooterNotice, fetchPack, loadPackIndex, type PackEntry } from '../utils/iconPacks';
import { loadRecipes, type RecipeInfo } from '../utils/packHelp';
import { insertIcon, type CatalogEntry } from '../utils/iconPicker';
import { canRedo, canUndo, createHistory, record, redo, undo, type History } from '../utils/history';
import { showAtNaturalSize } from '../utils/previewSize';
import { decodeLabelEntities } from '../utils/labelEntities';
import IconPicker from './IconPicker';
import PackHelp from './PackHelp';
import AboutDialog from './AboutDialog';
import ThemeToggle from './ThemeToggle';
import MenuButton from './MenuButton';
import DiagramBuilder, { type BuilderSelection } from './DiagramBuilder';
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
  group vpc(gcp:virtual-private-cloud)[Virtual Private Cloud] in gcp
  service lb(gcp:cloud-load-balancing)[Cloud Load Balancing] in gcp
  service run(gcp:cloud-run)[Cloud Run] in vpc
  service sql(gcp:cloud-sql)[Cloud SQL] in vpc
  service bq(gcp:bigquery)[BigQuery] in gcp
  service gcs(gcp:cloud-storage)[Cloud Storage] in gcp
  lb:R --> L:run
  run:R --> L:sql
  run:B --> T:bq
  bq:R --> L:gcs`
    },
    {
        name: 'AWS Architecture',
        requiresPack: 'aws',
        code: `architecture-beta
  group cloud(aws:aws-cloud)[AWS Cloud]
  group vpc(aws:virtual-private-cloud-vpc)[Virtual private cloud (VPC)] in cloud
  service cdn(aws:amazon-cloudfront)[Amazon CloudFront] in cloud
  service elb(aws:elastic-load-balancing)[Elastic Load Balancing] in vpc
  service ecs(aws:amazon-elastic-container-service)[Amazon Elastic Container Service] in vpc
  service db(aws:amazon-aurora)[Amazon Aurora] in vpc
  service s3(aws:amazon-simple-storage-service)[Amazon Simple Storage Service] in cloud
  cdn:R --> L:elb
  elb:R --> L:ecs
  ecs:B --> T:db
  cdn:B --> T:s3`
    },
    {
        name: 'Azure Architecture',
        requiresPack: 'azure',
        code: `architecture-beta
  group sub(azure:subscriptions)[Azure subscription]
  group vnet(azure:virtual-networks)[Azure Virtual Network] in sub
  service fd(azure:front-door-and-cdn-profiles)[Azure Front Door] in sub
  service app(azure:app-services)[Azure App Service] in vnet
  service sql(azure:sql-database)[Azure SQL Database] in vnet
  service kv(azure:key-vaults)[Azure Key Vault] in vnet
  service st(azure:storage-accounts)[Azure Storage] in sub
  fd:R --> L:app
  app:R --> L:sql
  app:B --> T:kv
  fd:B --> T:st`
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
const RESTORE_FAILED = 'Restore from export failed';

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

const INITIAL_CODE = `graph TD;
  A-->B;
  A-->C;
  B-->D;
  C-->D;`;

// An error card: a title that says what failed, then the details.
type Problem = { title: string; message: string };

const ErrorCard: React.FC<{ problem: Problem; role?: 'alert' }> = ({ problem, role }) => (
    <div className="error-box" role={role}>
        <p className="error-title">{problem.title}</p>
        <p className="error-detail">{problem.message}</p>
    </div>
);

const ENGINE_STATUS = {
    ready: { short: 'Engine ready', full: 'Render engine ready.' },
    warming: { short: 'Engine waking…', full: 'Waking the render engine so your first export is quick…' },
} as const;

const TABS = [{ id: 'code', label: 'Code' }, { id: 'build', label: 'Build' }] as const;
type Tab = typeof TABS[number]['id'];

const DiagramEditor: React.FC = () => {
    const [code, setCode] = useState<string>(INITIAL_CODE);
    // Undo/redo over the code: builder actions and icon insertions are steps, typing is coalesced.
    const [history, setHistory] = useState<History>(() => createHistory(INITIAL_CODE));
    const [tab, setTab] = useState<Tab>('code');
    const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ code: null, build: null });
    const [selection, setSelection] = useState<BuilderSelection | null>(null);
    // Counts finished preview renders, so the builder's marks are drawn again on each new SVG.
    const [renders, setRenders] = useState(0);
    // The icon picker in choosing mode (the builder's icon field), and the button that opened it.
    const [choosing, setChoosing] = useState<{ onChoose: (prefix: string, entry: CatalogEntry) => void; opener: HTMLElement } | null>(null);
    const [error, setError] = useState<Problem | null>(null);
    const [uploadError, setUploadError] = useState<Problem | null>(null);
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
    // The pack recipes this installation offers (empty on a hosted edition, which bundles its packs),
    // and the "How to add an icon pack" help with the element that opened it.
    const [recipeInfo, setRecipeInfo] = useState<RecipeInfo | null>(null);
    const [aboutOpen, setAboutOpen] = useState(false);
    const aboutButtonRef = useRef<HTMLButtonElement>(null);
    const [helpOpener, setHelpOpener] = useState<HTMLElement | null | undefined>(undefined); // undefined = closed
    const insertButtonRef = useRef<HTMLButtonElement>(null);
    // Set while the picker hands over to the help, so that closing the picker does not take the focus.
    const pickerHandoff = useRef(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Initialize Mermaid once
    useEffect(() => {
        const config: any = {
            startOnLoad: false,
            // 'strict' hardens rendering of untrusted diagrams (e.g. code extracted from an
            // uploaded export via "Restore from export..."): no HTML in labels, no click bindings.
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
                // Without a width, a Gantt chart takes the width of whatever element it is rendered
                // in. Same value as the render backend, so the chart is the one that is exported.
                useWidth: 1200,
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

    // Recipes are only needed to decide whether the "add an icon pack" entry points appear.
    useEffect(() => {
        let active = true;
        void loadRecipes().then((info) => { if (active) setRecipeInfo(info); });
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

                // Nothing to draw is not an error: Mermaid would answer "No diagram type detected".
                if (!code.trim()) {
                    const hint = document.createElement('p');
                    hint.className = 'preview-empty';
                    hint.textContent = 'Nothing to draw yet. Type Mermaid code, or start a diagram in the Build tab.';
                    previewRef.current.appendChild(hint);
                    setError(null);
                    return;
                }
                
                // Create unique ID (no dots - invalid for CSS selectors)
                const id = `mermaid-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
                
                // Try to render
                const result = await mermaid.render(id, code);
                
                // Show Mermaid's SVG as it is. The labels keep the lines and positions Mermaid gave them,
                // as in the export: re-wrapping them here moved them onto the icons and joined words.
                // Only character codes in labels are completed, as the export does (labelEntities).
                previewRef.current.innerHTML = decodeLabelEntities(result.svg);
                
                const svgInDOM = previewRef.current.querySelector('svg');
                
                if (svgInDOM) {
                    // The drawing area Mermaid chose, at its natural size, as in the export. Measuring
                    // what is drawn instead made a Gantt chart tens of thousands of pixels wide.
                    showAtNaturalSize(svgInDOM);
                    setRenders((n) => n + 1);
                } else {
                    console.warn('[WARNING] No SVG found in rendered content!');
                }
                
                setError(null);
            } catch (e) {
                console.error('[DIAGRAM RENDER FAILED]', e);
                const errMsg = e instanceof Error ? e.message : String(e);
                
                // Set error state
                if (errMsg.includes('syntax')) {
                    setError({ title: 'Mermaid syntax error', message: 'Check your diagram code or try a simpler example.' });
                } else {
                    setError({ title: 'Rendering failed', message: errMsg });
                }
                
                // Show error UI
                if (previewRef.current) {
                    // The message echoes user-supplied diagram text (possibly restored from an uploaded
                    // SVG), so render it as text, never as HTML.
                    previewRef.current.innerHTML = '';
                    const box = document.createElement('div');
                    box.className = 'preview-error';
                    const title = document.createElement('strong');
                    title.className = 'error-title';
                    title.textContent = 'Error';
                    const text = document.createElement('p');
                    text.className = 'error-detail';
                    text.textContent = errMsg;
                    box.append(title, text);
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

    // `typedAt`: the time of a keystroke in the code field (coalesced into one undo step); null otherwise.
    const remember = (next: string, typedAt: number | null = null) => setHistory((h) => record(h, next, typedAt));

    const editCode = (next: string, typedAt: number | null = null) => {
        setCode(next);
        remember(next, typedAt);
        if (wakeEngine() && engine !== 'ready') {
            setEngine('warming');
        }
    };

    const builderEdit = (next: string) => {
        caretRef.current = null;
        editCode(next);
    };

    const stepHistory = (step: (h: History) => History) => {
        const next = step(record(history, code));
        setHistory(next);
        caretRef.current = null;
        setCode(next.present);
    };

    const onTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
        const at = TABS.findIndex((t) => t.id === tab);
        const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: TABS.length - 1 }[e.key];
        if (to === undefined) return;
        e.preventDefault();
        const next = TABS[(to + TABS.length) % TABS.length].id;
        setTab(next);
        tabRefs.current[next]?.focus();
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
        if (pickerHandoff.current) {
            pickerHandoff.current = false;
            setChoosing(null);
            return;
        }
        // Choosing for the builder: focus goes back to the button that opened the picker.
        if (choosing) {
            setChoosing(null);
            choosing.opener.focus();
            return;
        }
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
            setUploadError({ title: RESTORE_FAILED, message: 'This file is too large (over 20 MB) to be an export from this tool.' });
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
                remember(extracted);
                setUploadError(null);
                setError(null);
            } else {
                setUploadError({
                    title: 'No Mermaid metadata found',
                    message: `This file was not created by this tool. Only SVG and PNG files exported from ${branding.productName} contain embedded source code.`,
                });
            }
        } catch (uploadErr) {
            console.error('Upload parse error:', uploadErr);
            setUploadError({ title: RESTORE_FAILED, message: 'Failed to read the file.' });
        } finally {
            event.target.value = '';
        }
    };

    const installedPacks = packs ?? [];
    // The help is offered only where recipes exist; a hosted edition has none.
    const recipes = recipeInfo?.recipes ?? [];
    const canAddPack = packs !== null && recipes.length > 0;
    const openHelp = (opener: HTMLElement | null) => setHelpOpener(opener);
    const closeHelp = () => {
        const opener = helpOpener;
        setHelpOpener(undefined);
        if (opener?.isConnected) opener.focus();
        else codeRef.current?.focus();
    };
    const hasPack = (prefix: string) => installedPacks.some((p) => p.prefix === prefix);
    const closeAbout = () => {
        setAboutOpen(false);
        aboutButtonRef.current?.focus();
    };
    const examples = EXAMPLES.filter((example) => !example.requiresPack || hasPack(example.requiresPack));
    // One footer paragraph per installed pack that has a notice (vendor wording from the pack,
    // product wording from the branding).
    const packNotices = installedPacks.flatMap((p) => {
        const text = composeFooterNotice(p, branding);
        return text ? [{ prefix: p.prefix, text }] : [];
    });

    return (
        <div className="editor-shell">
            <header className="topbar">
                <h1 className="topbar-brand">
                    <svg className="brand-mark" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
                        <rect x="1.5" y="2.5" width="9" height="7" rx="2" />
                        <rect x="13.5" y="14.5" width="9" height="7" rx="2" />
                        <path d="M6 9.5v4.5a2.5 2.5 0 0 0 2.5 2.5h5" />
                    </svg>
                    <span>{branding.productName}</span>
                </h1>
                <MenuButton
                    id="examples-button"
                    menuId="examples-menu"
                    label="Examples"
                    items={examples}
                    itemKey={(example) => example.name}
                    itemLabel={(example) => example.name}
                    onPick={(example) => { caretRef.current = null; editCode(example.code); }}
                />
                <label className="upload-btn" title="Load the Mermaid code back from an SVG or PNG exported by this tool">
                    Restore from export…
                    <input type="file" accept=".svg,.png" onChange={handleExportUpload} />
                </label>
                <div className="topbar-spacer" />
                <div className="topbar-export">
                    {exportState.phase === 'idle' && engine !== 'unknown' && (
                        <p className={`engine-hint ${engine}`} title={ENGINE_STATUS[engine].full}>
                            <span className="status-dot" aria-hidden="true" />
                            <span aria-hidden="true">{ENGINE_STATUS[engine].short}</span>
                            <span className="sr-only">{ENGINE_STATUS[engine].full}</span>
                        </p>
                    )}
                    <div className="format-toggle" role="radiogroup" aria-label="Download format">
                        <label>
                            <input type="radio" name="format" value="svg" checked={downloadFormat === 'svg'} onChange={() => setDownloadFormat('svg')} />
                            <span>SVG</span>
                        </label>
                        <label>
                            <input type="radio" name="format" value="png" checked={downloadFormat === 'png'} onChange={() => setDownloadFormat('png')} />
                            <span>PNG</span>
                        </label>
                    </div>
                    <button className="download-btn" onClick={handleDownload} disabled={isDownloading} aria-busy={isDownloading}>
                        {isDownloading ? 'Rendering…' : 'Download Secure Image'}
                    </button>
                    <ThemeToggle />
                    <button type="button" id="about-button" ref={aboutButtonRef} className="example-btn" onClick={() => setAboutOpen(true)}>About</button>
                </div>
                {exportState.phase !== 'idle' && (
                    <div className="export-popover">
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
                                <p className="error-title">Export failed</p>
                                <p className="error-detail">{exportState.message}</p>
                                {exportState.requestId && (
                                    <p className="export-reference">Reference: {exportState.requestId}</p>
                                )}
                                <div className="error-actions">
                                    {exportState.retryable && (
                                        <button className="retry-btn" onClick={handleDownload}>Try again</button>
                                    )}
                                    <button className="retry-btn" onClick={() => setExportState({ phase: 'idle' })}>Dismiss</button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </header>
            <div className="workspace">
                <section className="editor-pane" aria-label="Editor">
                    <div className="editor-tabs" role="tablist" aria-label="Editor">
                        {TABS.map((t) => (
                            <button
                                key={t.id}
                                ref={(el) => { tabRefs.current[t.id] = el; }}
                                type="button"
                                role="tab"
                                id={`editor-tab-${t.id}`}
                                aria-selected={tab === t.id}
                                aria-controls={`editor-panel-${t.id}`}
                                tabIndex={tab === t.id ? 0 : -1}
                                className={tab === t.id ? 'editor-tab active' : 'editor-tab'}
                                onClick={() => setTab(t.id)}
                                onKeyDown={onTabKeyDown}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>
                    <div id="editor-panel-code" role="tabpanel" aria-labelledby="editor-tab-code" className="editor-panel" hidden={tab !== 'code'}>
                        {installedPacks.length > 0 && (
                            <div className="code-tools">
                                <button ref={insertButtonRef} type="button" className="example-btn" onClick={() => setPickerOpen(true)}>Insert icon…</button>
                            </div>
                        )}
                        {installedPacks.length === 0 && canAddPack && (
                            <div className="code-tools">
                                <button type="button" className="example-btn" onClick={(e) => openHelp(e.currentTarget)}>Add an icon pack…</button>
                            </div>
                        )}
                        <textarea
                            ref={codeRef}
                            className="code-editor"
                            value={code}
                            onChange={(e) => { caretRef.current = e.target.selectionEnd; editCode(e.target.value, e.timeStamp); }}
                            onSelect={(e) => { caretRef.current = e.currentTarget.selectionEnd; }}
                            placeholder="Enter Mermaid code here..."
                            aria-label="Mermaid code"
                            spellCheck={false}
                        />
                    </div>
                    <div id="editor-panel-build" role="tabpanel" aria-labelledby="editor-tab-build" className="editor-panel" hidden={tab !== 'build'}>
                        <DiagramBuilder
                            code={code}
                            onEdit={builderEdit}
                            selection={selection}
                            onSelect={setSelection}
                            canUndo={canUndo(history)}
                            canRedo={canRedo(history)}
                            onUndo={() => stepHistory(undo)}
                            onRedo={() => stepHistory(redo)}
                            onChooseIcon={installedPacks.length > 0 ? (onChoose, opener) => setChoosing({ onChoose, opener }) : undefined}
                            onAddPack={installedPacks.length === 0 && canAddPack ? openHelp : undefined}
                            packs={packs}
                            active={tab === 'build'}
                            previewRef={previewRef}
                            renders={renders}
                        />
                    </div>
                    <div className="status-area">
                        {error && <ErrorCard problem={error} />}
                        {uploadError && <ErrorCard problem={uploadError} role="alert" />}
                    </div>
                </section>
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
                        <p className={error ? 'preview-info error' : 'preview-info'}>
                            <span className="status-dot" aria-hidden="true" />
                            {error ? 'Error' : 'Ready'}
                        </p>
                    </div>
                    <div className="preview-pane" ref={containerRef}>
                        <div
                            ref={previewRef}
                            className={tab === 'build' ? 'mermaid-preview selectable' : 'mermaid-preview'}
                            style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left' }}
                        />
                    </div>
                </div>
            </div>
            <footer className="legal-footer">
                <p>🔒 Privacy: No data stored.</p>
                {packNotices.map(({ prefix, text }) => (
                    <p key={prefix}>{text}</p>
                ))}
                {branding.basedOn && (
                    <p>{branding.productName} is based on <a href={branding.basedOn.url} target="_blank" rel="noopener noreferrer">{branding.basedOn.name}</a>, an open-source project under the Apache License 2.0.</p>
                )}
            </footer>
            {(pickerOpen || choosing) && installedPacks.length > 0 && (
                <IconPicker packs={installedPacks} code={code} onInsert={insertPackIcon} onChoose={choosing?.onChoose} onClose={closePicker}
                    onAddPack={canAddPack ? () => { pickerHandoff.current = true; openHelp(choosing?.opener ?? insertButtonRef.current); } : undefined} />
            )}
            {helpOpener !== undefined && canAddPack && recipeInfo && (
                <PackHelp recipes={recipeInfo.recipes} version={recipeInfo.version} installed={installedPacks} onClose={closeHelp} />
            )}
            {aboutOpen && (
                <AboutDialog
                    packs={packs}
                    canAddPack={canAddPack}
                    onAddPack={() => { setAboutOpen(false); openHelp(aboutButtonRef.current); }}
                    onClose={closeAbout}
                />
            )}
        </div>
    );
};

export default DiagramEditor;
