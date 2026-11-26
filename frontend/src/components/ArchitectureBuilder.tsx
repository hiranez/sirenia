import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CatalogEntry } from '../utils/iconPicker';
import { diagramKind, parseCatalog } from '../utils/iconPicker';
import { loadPackFile, type PackEntry } from '../utils/iconPacks';
import {
    connectNodes, directionOf, edges, findEdge, findNode, nodeName, nodeOutline, nodes, parseArchitecture, removeEdge, removeNode,
    startArchitecture,
    type ArchitectureModel, type EdgeItem, type EditResult, type NodeItem, type NodeKind, type Side,
} from '../utils/architectureModel';
import { drawMarks, nodeAt, previewSides } from '../utils/architecturePreview';
import { BUILTIN_SOURCE, groupFor, quickAddService, replacesNothing, type IconSource } from '../utils/quickAdd';
import { EMPTY_TEMPLATE_ID, availableTemplates, type Template } from '../utils/builderTemplates';
import BuilderForm, { type Done, type FormTarget } from './BuilderForm';
import QuickAdd, { type QuickChoice } from './QuickAdd';
import BuilderTemplates from './BuilderTemplates';
import BuilderShortcuts from './BuilderShortcuts';

/** The item selected in the builder. A connection has no id: its line, and the line's text to find it again. */
export type BuilderSelection = { kind: 'node'; id: string } | { kind: 'edge'; line: number; text: string };

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

const SIDE_WORDS: Record<Side, string> = { L: 'left', R: 'right', T: 'top', B: 'bottom' };
const ARROWS = { none: '—', forward: '→', backward: '←', both: '↔' };
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? 'Cmd' : 'Ctrl';
const UNDO_HINT = ` Undo: ${MOD}+Z`;

type Row = { key: string; selection: BuilderSelection; depth: number; node?: NodeItem; edge?: EdgeItem };

function edgeText(model: ArchitectureModel, edge: EdgeItem): string {
    const end = (id: string, side: Side) => {
        const n = findNode(model, id);
        return `${n ? nodeName(n) : id} (${SIDE_WORDS[side]})`;
    };
    return `${end(edge.from.id, edge.from.side)} ${ARROWS[directionOf(edge)]} ${end(edge.to.id, edge.to.side)}`;
}

const isEndpoint = (model: ArchitectureModel | null, id: string | null) => {
    const n = model && id !== null ? findNode(model, id) : undefined;
    return n !== undefined && n.kind !== 'group';
};

// The visual builder for architecture diagrams. It keeps no copy of the diagram: every render reads
// the current text, and every action replaces it with the text the model's edit returns.
const ArchitectureBuilder: React.FC<Props> = ({
    code, onEdit, selection, onSelect, canUndo, canRedo, onUndo, onRedo, onChooseIcon, onAddPack, packs, active, previewRef, renders,
}) => {
    const id = useId();
    const model = useMemo(() => parseArchitecture(code), [code]);
    const kind = diagramKind(code);
    const [adding, setAdding] = useState<{ target: FormTarget; seq: number } | null>(null);
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

    const sources = useMemo<IconSource[]>(() => [
        BUILTIN_SOURCE,
        ...(packs ?? []).flatMap((p) => {
            const entries = catalogs[p.prefix];
            return Array.isArray(entries) ? [{ prefix: p.prefix, label: p.label, entries }] : [];
        }),
    ], [packs, catalogs]);
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

    const selectedNode = model && selection?.kind === 'node' ? findNode(model, selection.id) : undefined;
    const selectedEdge = model && selection?.kind === 'edge' ? findEdge(model, selection.line, selection.text) : undefined;
    const selected = selectedNode ?? selectedEdge;
    const selectedId = selectedNode?.id ?? null;
    // Connect mode ends by itself when its node goes (an undo, an edit in the Code tab).
    const connecting = connectFrom !== null && isEndpoint(model, connectFrom) ? connectFrom : null;
    const target = connecting ? candidate : null;
    const sourceNode = connecting && model ? findNode(model, connecting) : undefined;

    const nodeRows: Row[] = model
        ? nodeOutline(model).map(({ node, depth }) => ({ key: `n:${node.id}`, depth, node, selection: { kind: 'node', id: node.id } }))
        : [];
    const edgeRows: Row[] = model
        ? edges(model).map((edge) => ({ key: `e:${edge.line}`, depth: 0, edge, selection: { kind: 'edge', line: edge.line, text: model.lines[edge.line] } }))
        : [];
    const selectedKey = selectedNode ? `n:${selectedNode.id}` : selectedEdge ? `e:${selectedEdge.line}` : null;

    // Keep the selected row in view, also when it was selected by a click in the preview.
    useEffect(() => {
        if (!selectedKey) return;
        listsRef.current?.querySelector(`[data-key="${CSS.escape(selectedKey)}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [selectedKey]);

    // The marks on the preview, drawn again after every render; only while building.
    useEffect(() => {
        const svg = previewRef.current?.querySelector('svg');
        if (svg) drawMarks(svg, { selected: active ? selectedId : null, connecting: connecting !== null, target });
    }, [previewRef, renders, active, selectedId, connecting, target]);

    const svgOf = () => previewRef.current?.querySelector('svg') ?? null;
    const say = (message: string) => setNotice(message);

    /** Apply a model edit; false (and the reason on the status line) when it was refused. */
    const apply = (result: EditResult, message: string): result is Extract<EditResult, { ok: true }> => {
        if (!result.ok) {
            say(result.error.message);
            return false;
        }
        if (result.code !== code) onEdit(result.code);
        say(`${message}${UNDO_HINT}`);
        return true;
    };

    const select = (next: BuilderSelection | null) => {
        setAdding(null);
        setPendingDelete(null);
        setNotice('');
        onSelect(next);
    };

    /** Focus the field where a row's item is edited: the label, or the first field when it has none. */
    const editRow = (row: Pick<Row, 'node' | 'edge'>) => {
        const field = row.edge ? 'From-node' : row.node?.kind === 'junction' ? 'parent' : 'label';
        refocus(field, '.builder-form [data-field]');
    };

    const startAdding = (what: NodeKind | 'edge') => {
        if (!model) return;
        // A new node goes into the selected group (or the selected node's group).
        const parent = groupFor(model, selectedId);
        const ends = nodes(model).filter((n) => n.kind !== 'group');
        const from = selectedNode && selectedNode.kind !== 'group' ? selectedNode.id : ends[0]?.id ?? '';
        const to = ends.find((n) => n.id !== from)?.id ?? '';
        const formTarget: FormTarget = what === 'edge' ? { mode: 'add', kind: 'edge', from, to } : { mode: 'add', kind: what, parent };
        setAdding((a) => ({ target: formTarget, seq: (a?.seq ?? 0) + 1 }));
        setConnectFrom(null);
        setNotice('');
        refocus(undefined, '.builder-form [data-field]');
    };

    const done: Done = (result, next, message) => {
        if (!result.ok) return result.error;
        const activeEl = document.activeElement;
        const field = activeEl instanceof HTMLElement && activeEl.closest('.builder-form') ? activeEl.dataset.field : undefined;
        refocus(next ? field : undefined, next ? '.builder-form [data-field="submit"]' : '.builder-outline [tabindex="0"]');
        if (result.code !== code) onEdit(result.code);
        setAdding(null);
        setNotice(result.code !== code ? `${message}${UNDO_HINT}` : message);
        if (next?.kind === 'edge') onSelect({ kind: 'edge', line: next.line, text: result.code.split('\n')[next.line] });
        else onSelect(next);
        return null;
    };

    const quickAdd = (choice: QuickChoice): string | null => {
        const parent = model ? groupFor(model, selectedId) : null;
        const result = quickAddService(code, choice.label, choice.icon, parent);
        if (!result.ok) return result.error.message;
        const group = parent && model ? findNode(model, parent) : undefined;
        apply(result, `Added ${choice.label.trim()}${group ? ` to ${nodeName(group)}` : ''}.`);
        setAdding(null);
        setConnectFrom(null);
        setPendingDelete(null);
        onSelect(result.id ? { kind: 'node', id: result.id } : null);
        return null;
    };

    const startConnect = () => {
        if (!model || !selectedNode) return say('Select a service or junction first, then connect it.');
        if (selectedNode.kind === 'group') return say('A connection starts at a service or junction, not at a group.');
        if (!nodes(model).some((n) => n.kind !== 'group' && n.id !== selectedNode.id)) return say('Add another service first, then connect the two.');
        setAdding(null);
        setPendingDelete(null);
        setConnectFrom(selectedNode.id);
        setCandidate(null);
        say(`Click the node to connect ${nodeName(selectedNode)} to. Esc cancels.`);
    };

    const cancelConnect = () => {
        setConnectFrom(null);
        setCandidate(null);
        say('Connect cancelled.');
    };

    const connectTo = (toId: string) => {
        if (!connecting || !model) return;
        const from = findNode(model, connecting);
        const to = findNode(model, toId);
        if (!from || !to) return;
        const sides = previewSides(svgOf(), connecting, toId);
        const result = connectNodes(code, connecting, toId, sides);
        const message = `Connected ${nodeName(from)} (${SIDE_WORDS[sides.from]}) to ${nodeName(to)} (${SIDE_WORDS[sides.to]}).`;
        if (!apply(result, message)) return;
        setConnectFrom(null);
        setCandidate(null);
        onSelect({ kind: 'node', id: toId });
    };

    const deleteSelected = () => {
        if (!model) return;
        if (selectedEdge) {
            if (apply(removeEdge(code, selectedEdge.line), `Deleted the connection ${edgeText(model, selectedEdge)}.`)) onSelect(null);
        } else if (selectedNode) {
            const name = nodeName(selectedNode);
            const inside = nodes(model).filter((n) => n.parent === selectedNode.id).length;
            if (selectedNode.kind === 'group' && inside > 0 && pendingDelete !== selectedNode.id) {
                const parent = selectedNode.parent ? findNode(model, selectedNode.parent) : undefined;
                setPendingDelete(selectedNode.id);
                return say(`${name} holds ${inside === 1 ? '1 item' : `${inside} items`}. Press Delete again to delete the group; ${inside === 1 ? 'it moves' : 'they move'} to ${parent ? nodeName(parent) : 'the top level'}.`);
            }
            const touching = edges(model).filter((e) => e.from.id === selectedNode.id || e.to.id === selectedNode.id).length;
            const extra = touching === 0 ? '' : touching === 1 ? ' and its connection' : ` and its ${touching} connections`;
            if (apply(removeNode(code, selectedNode.id), `Deleted ${name}${extra}.`)) onSelect(null);
        } else {
            return;
        }
        setPendingDelete(null);
        setConnectFrom(null);
        refocus(undefined, '.builder-outline [tabindex="0"]');
    };

    const undo = () => {
        if (!canUndo) return say('There is nothing to undo.');
        setConnectFrom(null);
        onUndo();
        say(`Undid the last change. Redo: ${MOD}+Shift+Z`);
    };
    const redo = () => {
        if (!canRedo) return say('There is nothing to redo.');
        setConnectFrom(null);
        onRedo();
        say(`Redid the change. Undo: ${MOD}+Z`);
    };

    const escape = () => {
        if (connecting) cancelConnect();
        else if (adding) setAdding(null);
        else if (selection) select(null);
    };

    const chooseTemplate = (template: Template) => {
        const next = template.id === EMPTY_TEMPLATE_ID ? startArchitecture(kind === 'empty' ? code : '') : template.code;
        onEdit(next);
        setAdding(null);
        setConnectFrom(null);
        onSelect(null);
        say(`Started from “${template.title}”.${UNDO_HINT}`);
        requestAnimationFrame(() => {
            rootRef.current?.closest('.editor-panel')?.scrollTo({ top: 0 });
            quickRef.current?.focus({ preventScroll: true });
        });
    };

    // Clicks in the preview select a node; in connect mode they choose the other end. A double click
    // puts the cursor in the node's label field. The handlers are attached again on every render, so
    // they always see the current state.
    useEffect(() => {
        const el = previewRef.current;
        if (!active || !el) return;
        const at = (e: MouseEvent) => {
            const svg = el.querySelector('svg');
            return svg ? nodeAt(svg, e.target, e.clientX, e.clientY) : null;
        };
        const onClick = (e: MouseEvent) => {
            if (!el.querySelector('svg')) return;
            const hit = at(e);
            if (connecting) {
                if (hit === null) cancelConnect();
                else connectTo(hit);
                return;
            }
            select(hit === null ? null : { kind: 'node', id: hit });
        };
        const onDoubleClick = (e: MouseEvent) => {
            const hit = at(e);
            if (connecting || hit === null || !model) return;
            const node = findNode(model, hit);
            if (!node) return;
            select({ kind: 'node', id: hit });
            editRow({ node });
        };
        const onMove = (e: MouseEvent) => {
            if (!connecting) return;
            const hit = at(e);
            const next = hit !== connecting && isEndpoint(model, hit) ? hit : null;
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
                if (row.node) connectTo(row.node.id);
                return;
            }
            select(row.selection);
            if (e.key === 'Enter') editRow(row);
        }
    };

    const formTarget: FormTarget | null = adding ? adding.target : selected ? { mode: 'edit', item: selected } : null;
    // A new form for every target and every change of its line, so the fields start from the text.
    const formKey = adding ? `add-${adding.seq}` : selected ? `${selected.kind}-${selected.line}-${model?.lines[selected.line]}` : '';
    const place = model ? groupFor(model, selectedId) : null;
    const placeNode = place && model ? findNode(model, place) : undefined;

    const renderRow = (row: Row, rows: Row[], index: number, role: 'treeitem' | 'option') => {
        const isSelected = row.key === selectedKey;
        const focusable = isSelected || (selectedKey === null || !rows.some((r) => r.key === selectedKey) ? index === 0 : false);
        const n = row.node;
        const icon = n && n.kind !== 'junction' ? n.icon : null;
        const className = ['builder-outline-row', isSelected && 'selected', connecting && n && n.id === target && 'candidate'].filter(Boolean).join(' ');
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
                onClick={() => (connecting ? n && connectTo(n.id) : select(row.selection))}
                onDoubleClick={() => { if (!connecting) editRow(row); }}
                onFocus={() => { if (connecting) setCandidate(n && n.id !== connecting && n.kind !== 'group' ? n.id : null); }}
                onKeyDown={(e) => onRowKeyDown(e, rows, index)}
            >
                {n ? (
                    <>
                        <span className={`builder-outline-kind kind-${n.kind}`}>{n.kind}</span>
                        <span className="builder-outline-label">{nodeName(n)}</span>
                        {icon && <code>{icon}</code>}
                        {n.kind === 'service' && n.iconText !== null && <code>"{n.iconText}"</code>}
                    </>
                ) : row.edge && (
                    <>
                        <span className="builder-outline-label">{edgeText(model!, row.edge)}</span>
                        {row.edge.label && <span className="builder-outline-note">{row.edge.label}</span>}
                    </>
                )}
            </li>
        );
    };

    const starters = templates.filter((t) => t.id !== EMPTY_TEMPLATE_ID);
    const confirmReplace = !replacesNothing(code);

    return (
        <div className="builder" ref={rootRef}>
            <div className="builder-tools">
                <span className="builder-toolbar-history" role="group" aria-label="History">
                    <button type="button" className="example-btn" onClick={undo} disabled={!canUndo} aria-keyshortcuts={`${MOD === 'Cmd' ? 'Meta' : 'Control'}+Z`}>Undo</button>
                    <button type="button" className="example-btn" onClick={redo} disabled={!canRedo} aria-keyshortcuts={`${MOD === 'Cmd' ? 'Meta' : 'Control'}+Shift+Z`}>Redo</button>
                </span>
                <BuilderShortcuts open={shortcutsOpen} onToggle={setShortcutsOpen} mod={MOD} />
            </div>

            <QuickAdd
                sources={sources}
                loading={loadingPacks}
                disabled={!model && kind !== 'empty'}
                place={placeNode ? nodeName(placeNode) : null}
                onAdd={quickAdd}
                inputRef={quickRef}
            />
            <div className="builder-toolbar" role="toolbar" aria-label="Builder">
                <button type="button" className="example-btn" onClick={() => startAdding('service')} disabled={!model}>Add service</button>
                <button type="button" className="example-btn" onClick={() => startAdding('group')} disabled={!model}>Add group</button>
                <button type="button" className="example-btn" onClick={() => startAdding('junction')} disabled={!model}>Add junction</button>
                <button type="button" className="example-btn" onClick={() => startAdding('edge')} disabled={!model}>Connect</button>
            </div>
            <p className="builder-notice" role="status" aria-live="polite">{notice}</p>

            {!model && (
                <div className="builder-empty">
                    <h3>Start a diagram</h3>
                    {kind === 'empty'
                        ? <p>Build an architecture diagram with groups, services and connections. The Mermaid code is written as you go. Type a product name above, or start from one of these:</p>
                        : <p>The builder works with architecture diagrams (<code>architecture-beta</code>). This diagram is of another kind: edit it in the Code tab, or start an architecture diagram here. That replaces the current diagram; Undo brings it back.</p>}
                    <BuilderTemplates templates={templates} packLabels={packLabels} confirm={confirmReplace} onChoose={chooseTemplate} />
                </div>
            )}

            {model && (
                <>
                    {selectedNode && (
                        <div className={sourceNode ? 'builder-selection connecting' : 'builder-selection'}>
                            {sourceNode ? (
                                <>
                                    <p>
                                        <span className="builder-selection-tag">Connecting from</span> <strong>{nodeName(sourceNode)}</strong>
                                        <span className="builder-selection-help">Click a node in the preview, or choose one in the outline and press Enter.</span>
                                    </p>
                                    <button type="button" className="example-btn" onClick={cancelConnect}>Cancel</button>
                                </>
                            ) : (
                                <>
                                    <p>
                                        <span className="builder-selection-tag">Selected</span> <strong>{nodeName(selectedNode)}</strong>
                                    </p>
                                    {selectedNode.kind !== 'group' && (
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
                            ? <p className="builder-hint">No groups or services yet. Type a product name in the field above, or start from a template below.</p>
                            : <ul role="tree" aria-labelledby={`${id}-nodes`}>{nodeRows.map((r, i) => renderRow(r, nodeRows, i, 'treeitem'))}</ul>}
                        <h3 id={`${id}-edges`}>Connections</h3>
                        {edgeRows.length === 0
                            ? <p className="builder-hint">No connections yet. Select a service and press C, then click another one.</p>
                            : <ul role="listbox" aria-labelledby={`${id}-edges`}>{edgeRows.map((r, i) => renderRow(r, edgeRows, i, 'option'))}</ul>}
                    </div>
                    {nodeRows.length === 0 && starters.length > 0 && (
                        <div className="builder-start">
                            <h3>Start from a template</h3>
                            <BuilderTemplates templates={starters} packLabels={packLabels} confirm={confirmReplace} onChoose={chooseTemplate} />
                        </div>
                    )}
                    {formTarget
                        ? <BuilderForm key={formKey} code={code} model={model} target={formTarget} onChooseIcon={onChooseIcon} onAddPack={onAddPack} onDone={done} onCancel={() => setAdding(null)} />
                        : nodeRows.length > 0 && <p className="builder-hint">Select an item above or in the preview to edit it. Double-click a node to edit its label.</p>}
                    {model.unmanaged.length > 0 && (
                        <p className="builder-unmanaged">
                            {model.unmanaged.length === 1
                                ? '1 line is not managed by the builder. It is kept as it is and can be edited in the Code tab.'
                                : `${model.unmanaged.length} lines are not managed by the builder. They are kept as they are and can be edited in the Code tab.`}
                        </p>
                    )}
                </>
            )}

            <details className="builder-code" open>
                <summary>Mermaid code</summary>
                <pre>{code}</pre>
            </details>
        </div>
    );
};

export default ArchitectureBuilder;
