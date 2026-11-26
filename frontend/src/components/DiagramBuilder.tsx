import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CatalogEntry } from '../utils/iconPicker';
import { diagramKind, parseCatalog } from '../utils/iconPicker';
import { loadPackFile, type PackEntry } from '../utils/iconPacks';
import { parseArchitecture, startArchitecture } from '../utils/architectureModel';
import { parseFlowchart, startFlowchart } from '../utils/flowchartModel';
import { BUILTIN_SOURCE, replacesNothing, type IconSource } from '../utils/quickAdd';
import { EMPTY_FLOWCHART_ID, EMPTY_TEMPLATE_ID, FLOWCHART_TEMPLATES, availableTemplates, type Template } from '../utils/builderTemplates';
import { architectureAdapter, architectureQuickAdd } from './architectureAdapter';
import { flowchartAdapter } from './flowchartAdapter';
import type { Adapter, BuilderSelection, FormDone, FormProps, NextSelection, Outcome, Result, Row } from './builderTypes';
import QuickAdd, { type QuickChoice } from './QuickAdd';
import BuilderTemplates from './BuilderTemplates';
import BuilderShortcuts from './BuilderShortcuts';

export type { BuilderSelection } from './builderTypes';

interface Props {
    code: string;
    /** A builder edit: one undo step. */
    onEdit: (code: string) => void;
    selection: BuilderSelection | null;
    onSelect: (selection: BuilderSelection | null) => void;
    canUndo: boolean;
    canRedo: boolean;
    onUndo: () => void;
    onRedo: () => void;
    /** Opens the icon picker in choosing mode (focus goes back to `opener`); absent when no pack is installed. */
    onChooseIcon?: (onChoose: (prefix: string, entry: CatalogEntry) => void, opener: HTMLElement) => void;
    /** Opens the "How to add an icon pack" help; offered when no pack is installed and recipes exist. */
    onAddPack?: (opener: HTMLElement) => void;
    /** Installed packs (null until the index is read); their catalogs feed quick add and the starters. */
    packs: PackEntry[] | null;
    /** Whether the Build tab is shown: shortcuts, preview clicks and marks work only then. */
    active: boolean;
    /** The element the preview SVG is rendered into, and a count that changes with every render. */
    previewRef: React.RefObject<HTMLDivElement | null>;
    renders: number;
}

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? 'Cmd' : 'Ctrl';
const UNDO_HINT = ` Undo: ${MOD}+Z`;
// Marks an Undo or Redo as the builder's own change of the text.
const HISTORY_STEP = '\u0000history';
// The architecture tools, shown (disabled) before there is a diagram to build.
const START_TOOLS = ['Add service', 'Add group', 'Add junction', 'Connect'];

/** The adapter's form for the selection or the new item. */
const FormSlot: React.FC<FormProps & { adapter: Adapter; formKey: string }> = ({ adapter, formKey, ...props }) => <>{adapter.renderForm(formKey, props)}</>;

// The visual builder: one shell for architecture diagrams and flowcharts, with an adapter for each
// (architectureAdapter, flowchartAdapter). It keeps no copy of the diagram: every render reads the
// current text, and every action replaces it with the text the model's edit returns.
const DiagramBuilder: React.FC<Props> = ({
    code, onEdit, selection, onSelect, canUndo, canRedo, onUndo, onRedo, onChooseIcon, onAddPack, packs, active, previewRef, renders,
}) => {
    const id = useId();
    const kind = diagramKind(code);
    const hasPacks = (packs ?? []).length > 0;
    const archModel = useMemo(() => parseArchitecture(code), [code]);
    const adapter = useMemo(() => {
        if (archModel) return architectureAdapter(code, archModel);
        const flow = parseFlowchart(code);
        return flow ? flowchartAdapter(code, flow, hasPacks) : null;
    }, [code, archModel, hasPacks]);
    const [adding, setAdding] = useState<{ target: unknown; seq: number } | null>(null);
    const [notice, setNotice] = useState('');
    // Connect mode: the node a connection starts from, and the node under the pointer or focus.
    const [connectFrom, setConnectFrom] = useState<string | null>(null);
    const [candidate, setCandidate] = useState<string | null>(null);
    // A group with nodes in it is deleted by a second Delete key.
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [catalogs, setCatalogs] = useState<Record<string, CatalogEntry[] | 'error'>>({});
    const requested = useRef(new Set<string>());
    const rootRef = useRef<HTMLDivElement>(null);
    const listsRef = useRef<HTMLDivElement>(null);
    const quickRef = useRef<HTMLInputElement>(null);

    // The catalogs of all installed packs, once the Build tab is first shown. The pack files are
    // shared with Mermaid's icon loader (one download per page).
    useEffect(() => {
        if (!active || !packs) return;
        for (const pack of packs) {
            if (requested.current.has(pack.prefix)) continue;
            requested.current.add(pack.prefix);
            loadPackFile(pack).then(
                (file) => setCatalogs((c) => ({ ...c, [pack.prefix]: parseCatalog(file, pack.prefix) })),
                () => {
                    requested.current.delete(pack.prefix);
                    setCatalogs((c) => ({ ...c, [pack.prefix]: 'error' }));
                },
            );
        }
    }, [active, packs]);

    // Mermaid's built-in icons belong to architecture diagrams; a flowchart gets pack icons only.
    const withBuiltins = adapter?.kind !== 'flowchart';
    const sources = useMemo<IconSource[]>(() => [
        ...(withBuiltins ? [BUILTIN_SOURCE] : []),
        ...(packs ?? []).flatMap((p) => {
            const entries = catalogs[p.prefix];
            return Array.isArray(entries) ? [{ prefix: p.prefix, label: p.label, entries }] : [];
        }),
    ], [packs, catalogs, withBuiltins]);
    const loadingPacks = (packs ?? []).filter((p) => catalogs[p.prefix] === undefined).map((p) => p.label);
    const templates = useMemo(() => availableTemplates(Object.fromEntries(
        Object.entries(catalogs).flatMap(([prefix, c]) => (Array.isArray(c) ? [[prefix, new Set(c.map((e) => e.icon))]] : [])),
    )), [catalogs]);
    const packLabels = Object.fromEntries((packs ?? []).map((p) => [p.prefix, p.label]));

    // The form is replaced after each action (it starts from the new text), so focus is put back on
    // the same field of the new form, or on `fallback`, once it is there.
    const refocus = (field: string | undefined, fallback: string) => requestAnimationFrame(() => {
        const root = rootRef.current;
        const target = (field && root?.querySelector<HTMLElement>(`.builder-form [data-field="${field}"]`)) || root?.querySelector<HTMLElement>(fallback);
        target?.focus();
    });

    const selected = adapter?.resolve(selection) ?? null;
    const selectedKey = selected?.key ?? null;
    // Connect mode ends by itself when its node goes (an undo, an edit in the Code tab).
    const connecting = connectFrom !== null && adapter?.isEndpoint(connectFrom) ? connectFrom : null;
    const target = connecting ? candidate : null;
    const nodeRows = adapter?.nodeRows ?? [];
    const edgeRows = adapter?.edgeRows ?? [];

    // Keep the selected row in view, also when it was selected by a click in the preview.
    useEffect(() => {
        if (!selectedKey) return;
        listsRef.current?.querySelector(`[data-key="${CSS.escape(selectedKey)}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [selectedKey]);

    // The marks on the preview, drawn again after every render; only while building.
    useEffect(() => {
        const svg = previewRef.current?.querySelector('svg');
        if (svg && adapter) adapter.drawMarks(svg, active ? selection : null, connecting, target);
        else svg?.querySelectorAll('.builder-overlay').forEach((el) => el.remove());
    }, [previewRef, renders, active, adapter, selection, connecting, target]);

    // When the text changes from outside the builder (typing in the Code tab, an example, a restored
    // export), what the status line says, connect mode and a pending second Delete no longer apply.
    const [ownChange, setOwnChange] = useState<string | null>(null);
    const [seenCode, setSeenCode] = useState(code);
    if (code !== seenCode) {
        setSeenCode(code);
        setOwnChange(null);
        if (ownChange !== code && ownChange !== HISTORY_STEP) {
            setNotice('');
            setConnectFrom(null);
            setPendingDelete(null);
        }
    }
    /** A builder edit: one undo step, and not a change from outside. */
    const edit = (next: string) => {
        setOwnChange(next);
        onEdit(next);
    };

    const svgOf = () => previewRef.current?.querySelector('svg') ?? null;
    const say = (message: string) => setNotice(message);

    /** Apply a model edit; false (and the reason on the status line) when it was refused. */
    const apply = (result: Result, message: string): result is Extract<Result, { ok: true }> => {
        if (!result.ok) {
            say(result.error.message);
            return false;
        }
        if (result.code !== code) edit(result.code);
        say(`${message}${UNDO_HINT}`);
        return true;
    };

    // `{ kind: 'edge', line }` (an architecture connection) is completed with the line's new text.
    const toSelection = (next: NextSelection | undefined, newCode: string): BuilderSelection | null => {
        if (!next) return null;
        return next.kind === 'edge' ? { kind: 'edge', line: next.line, text: newCode.split('\n')[next.line] } : next;
    };

    const select = (next: BuilderSelection | null) => {
        setAdding(null);
        setPendingDelete(null);
        setNotice('');
        onSelect(next);
    };

    /** Focus the field where a row's item is edited. */
    const editRow = (row: Pick<Row, 'field'>) => refocus(row.field, '.builder-form [data-field]');
    const rowOf = (s: BuilderSelection) => {
        const key = adapter?.resolve(s)?.key;
        return [...nodeRows, ...edgeRows].find((r) => r.key === key);
    };

    const startAdding = (what: string) => {
        if (!adapter) return;
        setAdding((a) => ({ target: adapter.addTarget(what, selection), seq: (a?.seq ?? 0) + 1 }));
        setConnectFrom(null);
        setNotice('');
        refocus(undefined, '.builder-form [data-field]');
    };

    const done: FormDone = (result, next, message) => {
        if (!result.ok) return result.error;
        const activeEl = document.activeElement;
        const field = activeEl instanceof HTMLElement && activeEl.closest('.builder-form') ? activeEl.dataset.field : undefined;
        refocus(next ? field : undefined, next ? '.builder-form [data-field="submit"]' : '.builder-outline [tabindex="0"]');
        if (result.code !== code) edit(result.code);
        setAdding(null);
        const full = `${message}${adapter?.afterEdit?.(result.also) ?? ''}`;
        setNotice(result.code !== code ? `${full}${UNDO_HINT}` : full);
        onSelect(toSelection(next, result.code));
        return null;
    };

    const quickAdd = (choice: QuickChoice): string | null => {
        const outcome = adapter ? adapter.quickAdd(choice, selection) : architectureQuickAdd(code, null, choice, selection);
        if (!outcome.result.ok) return outcome.result.error.message;
        apply(outcome.result, outcome.message);
        setAdding(null);
        setConnectFrom(null);
        setPendingDelete(null);
        onSelect(toSelection(outcome.select, outcome.result.code));
        return null;
    };

    const startConnect = () => {
        if (!adapter) return;
        const problem = adapter.connectProblem(selection);
        if (problem || !selected || selection?.kind !== 'node') return say(problem ?? '');
        setAdding(null);
        setPendingDelete(null);
        setConnectFrom(selection.id);
        setCandidate(null);
        say(`Click the node to connect ${selected.name} to. Esc cancels.`);
    };

    const cancelConnect = () => {
        setConnectFrom(null);
        setCandidate(null);
        say('Connect cancelled.');
    };

    const connectTo = (toId: string) => {
        if (!connecting || !adapter) return;
        const outcome = adapter.connect(connecting, toId, svgOf());
        if (!outcome || !apply(outcome.result, outcome.message)) return;
        setConnectFrom(null);
        setCandidate(null);
        onSelect(toSelection(outcome.select, outcome.result.code));
        if (outcome.field) refocus(outcome.field, '.builder-outline [tabindex="0"]');
    };

    const deleteSelected = () => {
        if (!adapter || !selection) return;
        const outcome = adapter.remove(selection, pendingDelete);
        if (!outcome) return;
        if ('ask' in outcome) {
            setPendingDelete(outcome.key);
            return say(outcome.ask);
        }
        if (apply(outcome.result, outcome.message)) onSelect(null);
        setPendingDelete(null);
        setConnectFrom(null);
        refocus(undefined, '.builder-outline [tabindex="0"]');
    };

    const undo = () => {
        if (!canUndo) return say('There is nothing to undo.');
        setConnectFrom(null);
        setOwnChange(HISTORY_STEP);
        onUndo();
        say(`Undid the last change. Redo: ${MOD}+Shift+Z`);
    };
    const redo = () => {
        if (!canRedo) return say('There is nothing to redo.');
        setConnectFrom(null);
        setOwnChange(HISTORY_STEP);
        onRedo();
        say(`Redid the change. Undo: ${MOD}+Z`);
    };

    const escape = () => {
        if (connecting) cancelConnect();
        else if (adding) setAdding(null);
        else if (selection) select(null);
    };

    const chooseTemplate = (template: Template) => {
        const blank = kind === 'empty' ? code : '';
        const next = template.id === EMPTY_TEMPLATE_ID ? startArchitecture(blank) : template.id === EMPTY_FLOWCHART_ID ? startFlowchart(blank) : template.code;
        edit(next);
        setAdding(null);
        setConnectFrom(null);
        onSelect(null);
        say(`Started from “${template.title}”.${UNDO_HINT}`);
        requestAnimationFrame(() => {
            rootRef.current?.closest('.editor-panel')?.scrollTo({ top: 0 });
            quickRef.current?.focus({ preventScroll: true });
        });
    };

    const applyOutcome = (outcome: Outcome) => apply(outcome.result, outcome.message);
    // Esc in a form field: back to the outline, the selection stays.
    const leaveForm = () => refocus(undefined, '.builder-outline [tabindex="0"]');

    // Clicks in the preview select an item; in connect mode they choose the other end. A double click
    // puts the cursor in the item's label field. The handlers are attached again on every render, so
    // they always see the current state.
    useEffect(() => {
        const el = previewRef.current;
        if (!active || !el) return;
        const svgAt = () => el.querySelector('svg');
        const onClick = (e: MouseEvent) => {
            const svg = svgAt();
            if (!svg) return;
            if (connecting) {
                const hit = adapter?.endpointAt(svg, e.target, e.clientX, e.clientY) ?? null;
                if (hit === null) cancelConnect();
                else connectTo(hit);
                return;
            }
            select(adapter?.hit(svg, e.target, e.clientX, e.clientY) ?? null);
        };
        const onDoubleClick = (e: MouseEvent) => {
            const svg = svgAt();
            const hit = svg && adapter ? adapter.hit(svg, e.target, e.clientX, e.clientY) : null;
            if (connecting || hit === null) return;
            const row = rowOf(hit);
            if (!row) return;
            select(hit);
            editRow(row);
        };
        const onMove = (e: MouseEvent) => {
            const svg = svgAt();
            if (!connecting || !svg || !adapter) return;
            const hit = adapter.endpointAt(svg, e.target, e.clientX, e.clientY);
            const next = hit !== connecting && adapter.isEndpoint(hit) ? hit : null;
            if (next !== candidate) setCandidate(next);
        };
        const onLeave = () => { if (connecting && candidate) setCandidate(null); };
        el.addEventListener('click', onClick);
        el.addEventListener('dblclick', onDoubleClick);
        el.addEventListener('mousemove', onMove);
        el.addEventListener('mouseleave', onLeave);
        return () => {
            el.removeEventListener('click', onClick);
            el.removeEventListener('dblclick', onDoubleClick);
            el.removeEventListener('mousemove', onMove);
            el.removeEventListener('mouseleave', onLeave);
        };
    });

    // Shortcuts of the Build tab. They never fire while a field has the focus or a dialog is open,
    // and only when the focus is in the Build tab, in the preview, or nowhere in particular.
    useEffect(() => {
        if (!active) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.defaultPrevented || e.isComposing) return;
            const t = e.target instanceof HTMLElement ? e.target : null;
            if (t?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), dialog')) return;
            if (document.querySelector('dialog[open]')) return;
            if (t && t !== document.body && !rootRef.current?.contains(t) && !t.closest('.preview-container')) return;
            const mod = e.ctrlKey || e.metaKey;
            if (mod && !e.altKey && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) redo();
                else undo();
                return;
            }
            if (mod || e.altKey) return;
            if (e.key === '/') {
                e.preventDefault();
                quickRef.current?.focus();
            } else if (e.key === 'c' || e.key === 'C') {
                e.preventDefault();
                startConnect();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                if (!selected) return;
                e.preventDefault();
                deleteSelected();
            } else if (e.key === 'Escape') {
                escape();
            } else if (e.key === '?') {
                e.preventDefault();
                setShortcutsOpen((open) => !open);
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    });

    const focusRow = (key: string) => listsRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();

    // Arrow keys, Home and End move through one list of rows (the selection follows, except in connect
    // mode); Enter edits the row's label, Space selects it; in connect mode both choose it as the other end.
    const onRowKeyDown = (e: React.KeyboardEvent<HTMLElement>, rows: Row[], at: number) => {
        const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: rows.length - 1 }[e.key];
        const row = rows[at];
        if (to !== undefined) {
            e.preventDefault();
            const next = rows[Math.min(Math.max(to, 0), rows.length - 1)];
            if (!next) return;
            if (!connecting) select(next.selection);
            focusRow(next.key);
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (connecting) {
                if (row.target) connectTo(row.target);
                return;
            }
            select(row.selection);
            if (e.key === 'Enter') editRow(row);
        }
    };

    const formTarget = adding ? adding.target : selected && selection ? adapter?.editTarget(selection) : null;
    // A new form for every target and every change of its text, so the fields start from the text.
    const formKey = adding ? `add-${adding.seq}` : selected?.formKey ?? '';
    const placeName = adapter?.placeName(selection) ?? null;

    const renderRow = (row: Row, rows: Row[], index: number, role: 'treeitem' | 'option') => {
        const isSelected = row.key === selectedKey;
        const focusable = isSelected || (selectedKey === null || !rows.some((r) => r.key === selectedKey) ? index === 0 : false);
        const className = ['builder-outline-row', isSelected && 'selected', connecting && row.target !== null && row.target === target && 'candidate'].filter(Boolean).join(' ');
        return (
            <li
                key={row.key}
                data-key={row.key}
                role={role}
                aria-selected={isSelected}
                aria-level={role === 'treeitem' ? row.depth + 1 : undefined}
                tabIndex={focusable ? 0 : -1}
                className={className}
                style={{ paddingLeft: `${10 + row.depth * 18}px` }}
                onClick={() => (connecting ? row.target && connectTo(row.target) : select(row.selection))}
                onDoubleClick={() => { if (!connecting) editRow(row); }}
                onFocus={() => { if (connecting) setCandidate(row.target !== connecting && adapter?.isEndpoint(row.target) ? row.target : null); }}
                onKeyDown={(e) => onRowKeyDown(e, rows, index)}
            >
                {row.tag && <span className={`builder-outline-kind kind-${row.tag}`}>{row.tag}</span>}
                <span className="builder-outline-label">{row.label}</span>
                {row.codes.map((c) => <code key={c}>{c}</code>)}
                {row.note && <span className="builder-outline-note">{row.note}</span>}
            </li>
        );
    };

    const ownStarters = adapter?.kind === 'flowchart' ? FLOWCHART_TEMPLATES.filter((t) => t.id !== EMPTY_FLOWCHART_ID) : templates.filter((t) => t.id !== EMPTY_TEMPLATE_ID);
    const confirmReplace = adapter ? !adapter.keepsNothing : !replacesNothing(code);
    const texts = adapter?.texts;
    const toolChoice = adapter?.toolChoice;

    return (
        <div className="builder" ref={rootRef}>
            <div className="builder-tools">
                <span className="builder-toolbar-history" role="group" aria-label="History">
                    <button type="button" className="example-btn" onClick={undo} disabled={!canUndo} aria-keyshortcuts={`${MOD === 'Cmd' ? 'Meta' : 'Control'}+Z`}>Undo</button>
                    <button type="button" className="example-btn" onClick={redo} disabled={!canRedo} aria-keyshortcuts={`${MOD === 'Cmd' ? 'Meta' : 'Control'}+Shift+Z`}>Redo</button>
                </span>
                <BuilderShortcuts open={shortcutsOpen} onToggle={setShortcutsOpen} mod={MOD} noun={texts?.noun ?? 'service'} />
            </div>

            <QuickAdd
                sources={sources}
                loading={loadingPacks}
                disabled={!adapter && kind !== 'empty'}
                place={placeName}
                onAdd={quickAdd}
                inputRef={quickRef}
                noun={texts?.noun ?? 'service'}
                placeholder={texts?.quickPlaceholder ?? 'Add a service: type a product or icon name'}
                customNote={texts?.customNote ?? 'Built-in'}
                customIcon={texts ? texts.customIcon : 'server'}
            />
            <div className="builder-toolbar" role="toolbar" aria-label="Builder">
                {adapter
                    ? adapter.tools.map((t) => <button key={t.what} type="button" className="example-btn" onClick={() => startAdding(t.what)}>{t.label}</button>)
                    : START_TOOLS.map((label) => <button key={label} type="button" className="example-btn" disabled>{label}</button>)}
                {toolChoice && (
                    <span className="builder-segmented" role="group" aria-labelledby={`${id}-choice`}>
                        <span id={`${id}-choice`} className="sr-only">{toolChoice.label}</span>
                        {toolChoice.options.map((o) => (
                            <button
                                key={o.value}
                                type="button"
                                className="builder-segment"
                                aria-pressed={o.value === toolChoice.value}
                                aria-label={o.label}
                                title={`${toolChoice.label}: ${o.label.toLowerCase()}`}
                                onClick={() => { if (o.value !== toolChoice.value) applyOutcome(toolChoice.set(o.value)); }}
                            >
                                <span aria-hidden="true">{o.symbol}</span>
                            </button>
                        ))}
                    </span>
                )}
            </div>
            <p className="builder-notice" role="status" aria-live="polite">{notice}</p>

            {!adapter && (
                <div className="builder-empty">
                    <h3>Start a diagram</h3>
                    {kind === 'empty'
                        ? <p>Build an architecture diagram with groups, services and connections, or a flowchart with steps, decisions and arrows. The Mermaid code is written as you go. Type a product name above to start an architecture diagram, or start from one of these:</p>
                        : <p>The builder works with architecture diagrams (<code>architecture-beta</code>) and flowcharts (<code>flowchart</code>). This diagram is of another kind: edit it in the Code tab, or start a new diagram here. That replaces the current diagram; Undo brings it back.</p>}
                    <div className="builder-start-group" role="group" aria-labelledby={`${id}-arch`}>
                        <h4 id={`${id}-arch`}>Architecture diagram</h4>
                        <BuilderTemplates templates={templates} packLabels={packLabels} confirm={confirmReplace} onChoose={chooseTemplate} />
                    </div>
                    <div className="builder-start-group" role="group" aria-labelledby={`${id}-flow`}>
                        <h4 id={`${id}-flow`}>Flowchart</h4>
                        <BuilderTemplates templates={[...FLOWCHART_TEMPLATES]} packLabels={packLabels} confirm={confirmReplace} onChoose={chooseTemplate} />
                    </div>
                </div>
            )}

            {adapter && texts && (
                <>
                    {selected?.isNode && (
                        <div className={connecting ? 'builder-selection connecting' : 'builder-selection'}>
                            {connecting ? (
                                <>
                                    <p>
                                        <span className="builder-selection-tag">Connecting from</span> <strong>{adapter.name(connecting)}</strong>
                                        <span className="builder-selection-help">Click a node in the preview, or choose one in the outline and press Enter.</span>
                                    </p>
                                    <button type="button" className="example-btn" onClick={cancelConnect}>Cancel</button>
                                </>
                            ) : (
                                <>
                                    <p>
                                        <span className="builder-selection-tag">Selected</span> <strong>{selected.name}</strong>
                                    </p>
                                    {selected.connectable && (
                                        <button type="button" className="example-btn" onClick={startConnect} aria-keyshortcuts="C">
                                            Connect to… <kbd aria-hidden="true">C</kbd>
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                    <div className="builder-outline" ref={listsRef}>
                        <h3 id={`${id}-nodes`}>Diagram</h3>
                        {nodeRows.length === 0
                            ? <p className="builder-hint">{texts.noNodes}</p>
                            : <ul role="tree" aria-labelledby={`${id}-nodes`}>{nodeRows.map((r, i) => renderRow(r, nodeRows, i, 'treeitem'))}</ul>}
                        <h3 id={`${id}-edges`}>Connections</h3>
                        {edgeRows.length === 0
                            ? <p className="builder-hint">{texts.noEdges}</p>
                            : <ul role="listbox" aria-labelledby={`${id}-edges`}>{edgeRows.map((r, i) => renderRow(r, edgeRows, i, 'option'))}</ul>}
                    </div>
                    {nodeRows.length === 0 && ownStarters.length > 0 && (
                        <div className="builder-start">
                            <h3>Start from a template</h3>
                            <BuilderTemplates templates={ownStarters} packLabels={packLabels} confirm={confirmReplace} onChoose={chooseTemplate} />
                        </div>
                    )}
                    {formTarget
                        ? <FormSlot adapter={adapter} formKey={formKey} code={code} target={formTarget} onChooseIcon={onChooseIcon} onAddPack={onAddPack} onDone={done} onCancel={() => setAdding(null)} onLeave={leaveForm} />
                        : nodeRows.length > 0 && <p className="builder-hint">{texts.selectHint}</p>}
                    {adapter.unmanaged && <p className="builder-unmanaged">{adapter.unmanaged}</p>}
                </>
            )}

            <details className="builder-code" open>
                <summary>Mermaid code</summary>
                <pre>{code}</pre>
            </details>
        </div>
    );
};

export default DiagramBuilder;
