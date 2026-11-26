import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CatalogEntry } from '../utils/iconPicker';
import { diagramKind } from '../utils/iconPicker';
import {
    directionOf, edges, findEdge, findNode, nodeName, nodeOutline, parseArchitecture, startArchitecture,
    type ArchitectureModel, type EdgeItem, type NodeItem, type NodeKind, type Side,
} from '../utils/architectureModel';
import BuilderForm, { type Done, type FormTarget } from './BuilderForm';

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
}

const SIDE_WORDS: Record<Side, string> = { L: 'left', R: 'right', T: 'top', B: 'bottom' };
const ARROWS = { none: '—', forward: '→', backward: '←', both: '↔' };
const NEW_DIAGRAM = 'architecture-beta\n';

type Row = { key: string; selection: BuilderSelection; depth: number; node?: NodeItem; edge?: EdgeItem };

function edgeText(model: ArchitectureModel, edge: EdgeItem): string {
    const end = (id: string, side: Side) => {
        const n = findNode(model, id);
        return `${n ? nodeName(n) : id} (${SIDE_WORDS[side]})`;
    };
    return `${end(edge.from.id, edge.from.side)} ${ARROWS[directionOf(edge)]} ${end(edge.to.id, edge.to.side)}`;
}

/** Arrow keys, Home and End move the selection within one list of rows (focus follows). */
function onRowKeys(e: React.KeyboardEvent<HTMLElement>, rows: Row[], at: number, select: (row: Row) => void) {
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: rows.length - 1 }[e.key];
    if (to === undefined && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const row = rows[to === undefined ? at : Math.min(Math.max(to, 0), rows.length - 1)];
    if (!row) return;
    select(row);
    const list = e.currentTarget.parentElement;
    (list?.querySelector(`[data-key="${CSS.escape(row.key)}"]`) as HTMLElement | null)?.focus();
}

// The visual builder for architecture diagrams. It keeps no copy of the diagram: every render reads
// the current text, and every action replaces it with the text the model's edit returns.
const ArchitectureBuilder: React.FC<Props> = ({ code, onEdit, selection, onSelect, canUndo, canRedo, onUndo, onRedo, onChooseIcon, onAddPack }) => {
    const id = useId();
    const model = useMemo(() => parseArchitecture(code), [code]);
    const kind = diagramKind(code);
    const [adding, setAdding] = useState<{ target: FormTarget; seq: number } | null>(null);
    const [confirmReplace, setConfirmReplace] = useState(false);
    const [notice, setNotice] = useState('');
    const rootRef = useRef<HTMLDivElement>(null);
    const listsRef = useRef<HTMLDivElement>(null);

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

    const select = (row: Row) => {
        setAdding(null);
        setNotice('');
        onSelect(row.selection);
    };

    const startAdding = (what: NodeKind | 'edge') => {
        if (!model) return;
        // A new node goes into the selected group (or the selected node's group).
        const parent = selectedNode ? (selectedNode.kind === 'group' ? selectedNode.id : selectedNode.parent) : null;
        const ends = model.items.filter((i): i is NodeItem => i.kind === 'service' || i.kind === 'junction');
        const from = selectedNode && selectedNode.kind !== 'group' ? selectedNode.id : ends[0]?.id ?? '';
        const to = ends.find((n) => n.id !== from)?.id ?? '';
        const target: FormTarget = what === 'edge' ? { mode: 'add', kind: 'edge', from, to } : { mode: 'add', kind: what, parent };
        setAdding((a) => ({ target, seq: (a?.seq ?? 0) + 1 }));
        setNotice('');
        refocus(undefined, '.builder-form [data-field]');
    };

    const done: Done = (result, next, message) => {
        if (!result.ok) return result.error;
        const active = document.activeElement;
        const field = active instanceof HTMLElement && active.closest('.builder-form') ? active.dataset.field : undefined;
        refocus(next ? field : undefined, next ? '.builder-form [data-field="submit"]' : '.builder-outline [tabindex="0"]');
        if (result.code !== code) onEdit(result.code);
        setAdding(null);
        setNotice(message);
        if (next?.kind === 'edge') onSelect({ kind: 'edge', line: next.line, text: result.code.split('\n')[next.line] });
        else onSelect(next);
        return null;
    };

    const replaceWithNew = () => {
        onEdit(NEW_DIAGRAM);
        setConfirmReplace(false);
        setNotice('Started a new architecture diagram. Undo brings the previous one back.');
    };

    const formTarget: FormTarget | null = adding ? adding.target : selected ? { mode: 'edit', item: selected } : null;
    // A new form for every target and every change of its line, so the fields start from the text.
    const formKey = adding ? `add-${adding.seq}` : selected ? `${selected.kind}-${selected.line}-${model?.lines[selected.line]}` : '';

    const renderRow = (row: Row, rows: Row[], index: number, role: 'treeitem' | 'option') => {
        const isSelected = row.key === selectedKey;
        const focusable = isSelected || (selectedKey === null || !rows.some((r) => r.key === selectedKey) ? index === 0 : false);
        const n = row.node;
        const icon = n && n.kind !== 'junction' ? n.icon : null;
        return (
            <li
                key={row.key}
                data-key={row.key}
                role={role}
                aria-selected={isSelected}
                aria-level={role === 'treeitem' ? row.depth + 1 : undefined}
                tabIndex={focusable ? 0 : -1}
                className={isSelected ? 'builder-outline-row selected' : 'builder-outline-row'}
                style={{ paddingLeft: `${10 + row.depth * 18}px` }}
                onClick={() => select(row)}
                onKeyDown={(e) => onRowKeys(e, rows, index, select)}
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

    return (
        <div className="builder" ref={rootRef}>
            <div className="builder-toolbar" role="toolbar" aria-label="Builder">
                <button type="button" className="example-btn" onClick={() => startAdding('service')} disabled={!model}>Add service</button>
                <button type="button" className="example-btn" onClick={() => startAdding('group')} disabled={!model}>Add group</button>
                <button type="button" className="example-btn" onClick={() => startAdding('junction')} disabled={!model}>Add junction</button>
                <button type="button" className="example-btn" onClick={() => startAdding('edge')} disabled={!model}>Connect</button>
                <span className="builder-toolbar-history">
                    <button type="button" className="example-btn" onClick={onUndo} disabled={!canUndo}>Undo</button>
                    <button type="button" className="example-btn" onClick={onRedo} disabled={!canRedo}>Redo</button>
                </span>
            </div>
            <p className="builder-notice" role="status" aria-live="polite">{notice}</p>

            {kind === 'empty' && (
                <div className="builder-empty">
                    <p>Build an architecture diagram with groups, services and connections. The Mermaid code is written as you go.</p>
                    <button type="button" className="icon-picker-primary" onClick={() => onEdit(startArchitecture(code))}>Start an architecture diagram</button>
                </div>
            )}
            {(kind === 'flowchart' || kind === 'other') && (
                <div className="builder-empty">
                    <p>The builder works with architecture diagrams (<code>architecture-beta</code>). This diagram is of another kind: edit it in the Code tab, or start a new architecture diagram.</p>
                    {confirmReplace ? (
                        <div className="builder-confirm" role="group" aria-label="Replace the diagram">
                            <p>This replaces the current diagram with an empty architecture diagram. Undo brings it back.</p>
                            <div className="builder-actions">
                                <button type="button" className="example-btn builder-danger" onClick={replaceWithNew}>Replace the diagram</button>
                                <button type="button" className="example-btn" onClick={() => setConfirmReplace(false)}>Keep it</button>
                            </div>
                        </div>
                    ) : (
                        <button type="button" className="example-btn" onClick={() => setConfirmReplace(true)}>New architecture diagram</button>
                    )}
                </div>
            )}

            {model && (
                <>
                    <div className="builder-outline" ref={listsRef}>
                        <h3 id={`${id}-nodes`}>Diagram</h3>
                        {nodeRows.length === 0
                            ? <p className="builder-hint">No groups or services yet. Use "Add service" or "Add group".</p>
                            : <ul role="tree" aria-labelledby={`${id}-nodes`}>{nodeRows.map((r, i) => renderRow(r, nodeRows, i, 'treeitem'))}</ul>}
                        <h3 id={`${id}-edges`}>Connections</h3>
                        {edgeRows.length === 0
                            ? <p className="builder-hint">No connections yet.</p>
                            : <ul role="listbox" aria-labelledby={`${id}-edges`}>{edgeRows.map((r, i) => renderRow(r, edgeRows, i, 'option'))}</ul>}
                    </div>
                    {formTarget
                        ? <BuilderForm key={formKey} code={code} model={model} target={formTarget} onChooseIcon={onChooseIcon} onAddPack={onAddPack} onDone={done} onCancel={() => setAdding(null)} />
                        : <p className="builder-hint">Select an item above or in the preview to edit it, or add one.</p>}
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
