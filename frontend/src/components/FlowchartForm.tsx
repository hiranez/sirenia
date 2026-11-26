import React, { useId, useState } from 'react';
import {
    LINE_STYLES, SHAPES, addEdge, addNode, addSubgraph, findEdge, findNode, findSubgraph, itemName, lineStyleOf, nodeName,
    removeEdge, removeNode, removeSubgraph, setNodeParent, subgraphChoices, subgraphName, subgraphsInside, updateEdge, updateNode, updateSubgraph,
    type EditResult, type FlowchartModel, type LineStyle, type ShapeName,
} from '../utils/flowchartModel';
import type { BuilderSelection, FormProps } from './builderTypes';

/** What the form edits: a new node, subgraph or connection (with the values to start from), or the selection. */
export type FlowTarget =
    | { mode: 'add'; kind: 'node' | 'subgraph'; parent: string | null }
    | { mode: 'add'; kind: 'edge'; from: string; to: string }
    | { mode: 'edit'; selection: BuilderSelection };

type Props = Omit<FormProps, 'target'> & { model: FlowchartModel; target: FlowTarget };

const OTHER = ':other';
const ICON = ':icon';

// Editor of one node, subgraph or connection of a flowchart. Values are text in form fields; the icon
// is a name (`gcp:cloud-run`), never a picture.
const FlowchartForm: React.FC<Props> = ({ code, model, target, onChooseIcon, onAddPack, onDone, onCancel, onLeave }) => {
    const id = useId();
    const [error, setError] = useState<{ code: string; message: string } | null>(null);
    const adding = target.mode === 'add';
    const sel = target.mode === 'edit' ? target.selection : null;
    const node = sel?.kind === 'node' ? findNode(model, sel.id) : undefined;
    const sub = sel?.kind === 'node' && !node ? findSubgraph(model, sel.id) : undefined;
    const edge = sel?.kind === 'link' ? findEdge(model, sel.key) : undefined;
    const kind = target.mode === 'add' ? target.kind : node ? 'node' : sub ? 'subgraph' : 'edge';
    const startParent = target.mode === 'add' && target.kind !== 'edge' ? target.parent ?? '' : '';

    // Node fields.
    const [label, setLabel] = useState(node ? nodeName(node) : '');
    const [shape, setShape] = useState<string>(node ? (node.icon ? ICON : node.shape === 'other' ? OTHER : node.shape) : 'rect');
    const [icon, setIcon] = useState(node?.icon ?? '');
    const [parent, setParent] = useState(node?.parent ?? sub?.parent ?? startParent);
    // Subgraph field.
    const [title, setTitle] = useState(sub?.title ?? '');
    // Connection fields.
    const [fromId, setFromId] = useState(edge?.from ?? (target.mode === 'add' && target.kind === 'edge' ? target.from : ''));
    const [toId, setToId] = useState(edge?.to ?? (target.mode === 'add' && target.kind === 'edge' ? target.to : ''));
    const [edgeLabel, setEdgeLabel] = useState(edge?.label ?? '');
    const [line, setLine] = useState<string>(edge ? lineStyleOf(edge) ?? OTHER : 'arrow');

    const parents = kind === 'subgraph' ? subgraphChoices(model, sub?.key ?? null) : subgraphChoices(model, null);
    const parentName = (key: string) => (findSubgraph(model, key) ? subgraphName(findSubgraph(model, key)!) : key);
    const readOnly = (sub && !sub.managed) || edge?.shared;

    const show = (result: { code: string; message: string } | null) => setError(result);

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        if (kind === 'edge') {
            const spec = { from: fromId, to: toId, label: edgeLabel, line: line === OTHER ? undefined : (line as LineStyle) };
            const result = edge ? updateEdge(code, edge.key, spec) : addEdge(code, spec);
            show(onDone(result, result.ok && result.key ? { kind: 'link', key: result.key } : null, edge ? 'Connection updated.' : 'Connection added.'));
            return;
        }
        if (kind === 'subgraph') {
            const result = sub ? updateSubgraph(code, sub.key, { title, parent: parent || null }) : addSubgraph(code, { title, parent: parent || null });
            show(onDone(result, result.ok && result.id ? { kind: 'node', id: result.id } : null, `${sub ? 'Updated' : 'Added'} ${title.trim()}.`));
            return;
        }
        const shapeValue = shape === ICON || shape === OTHER ? undefined : (shape as ShapeName);
        let result: EditResult;
        if (node) {
            result = updateNode(code, node.id, { label, shape: icon ? undefined : shapeValue, icon: icon || null });
            if (result.ok && (parent || null) !== node.parent) result = setNodeParent(result.code, node.id, parent || null);
        } else {
            result = addNode(code, { label, shape: shapeValue, icon: icon || null, parent: parent || null });
        }
        show(onDone(result, result.ok && result.id ? { kind: 'node', id: result.id } : null, `${node ? 'Updated' : 'Added'} ${label.trim()}.`));
    };

    const remove = () => {
        if (edge) show(onDone(removeEdge(code, edge.key), null, 'Connection deleted.'));
        else if (sub) show(onDone(removeSubgraph(code, sub.key), null, `Deleted ${subgraphName(sub)}.`));
        else if (node) {
            const touching = model.edges.filter((x) => x.from === node.id || x.to === node.id).length;
            const extra = touching === 0 ? '' : touching === 1 ? ' and its connection' : ` and its ${touching} connections`;
            show(onDone(removeNode(code, node.id), null, `Deleted ${nodeName(node)}${extra}.`));
        }
    };

    const choose = (e: React.MouseEvent<HTMLButtonElement>) => onChooseIcon?.((prefix, entry) => {
        setIcon(`${prefix}:${entry.icon}`);
        setLabel((current) => (current.trim() ? current : entry.name));
        setError(null);
    }, e.currentTarget);

    // Esc in a field leaves the form; the selection stays.
    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key !== 'Escape' || !(e.target instanceof HTMLElement) || !e.target.closest('input, select')) return;
        e.preventDefault();
        onLeave();
    };

    const errorId = `${id}-error`;
    const invalid = (...codes: string[]) => (error && codes.includes(error.code) ? { 'aria-invalid': true, 'aria-describedby': errorId } : {});
    const nodeOptions = model.nodes.map((n) => <option key={n.id} value={n.id}>{nodeName(n)} ({n.id})</option>);
    const endpoint = (value: string, set: (v: string) => void, which: 'From' | 'To') => (
        <label className="builder-field">
            <span>{which}</span>
            <select data-field={`${which}-node`} value={value} onChange={(e) => set(e.target.value)} {...invalid('endpoint', 'duplicate')}>
                {value === '' && <option value="">Choose a node</option>}
                {value !== '' && !findNode(model, value) && <option value={value}>{itemName(model, value)} ({value})</option>}
                {nodeOptions}
            </select>
        </label>
    );
    const heading = adding
        ? `New ${kind === 'edge' ? 'connection' : kind}`
        : kind === 'edge' ? 'Connection' : kind === 'subgraph' ? 'Subgraph ' : 'Node ';
    const ownId = node?.id ?? sub?.id ?? null;

    return (
        <form className="builder-form" onSubmit={submit} onKeyDown={onKeyDown} aria-labelledby={`${id}-title`} noValidate>
            <h3 id={`${id}-title`}>
                {heading}
                {ownId && <code>{ownId}</code>}
            </h3>
            {kind === 'edge' && (
                <>
                    {model.nodes.length < 2 && <p className="builder-hint">A connection joins two nodes. Add them first.</p>}
                    {edge?.shared && <p className="builder-hint">This connection is written with &amp; together with others. Change it in the Code tab.</p>}
                    {endpoint(fromId, setFromId, 'From')}
                    {endpoint(toId, setToId, 'To')}
                    <label className="builder-field">
                        <span>Label (optional)</span>
                        <input data-field="edge-label" type="text" value={edgeLabel} onChange={(e) => setEdgeLabel(e.target.value)} autoComplete="off" disabled={!!readOnly} {...invalid('label')} />
                    </label>
                    <label className="builder-field">
                        <span>Line</span>
                        <select data-field="line" value={line} onChange={(e) => setLine(e.target.value)} disabled={!!readOnly}>
                            {LINE_STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                            {line === OTHER && edge && <option value={OTHER}>As written in the code</option>}
                        </select>
                    </label>
                </>
            )}
            {kind === 'subgraph' && (
                <>
                    {readOnly && <p className="builder-hint">This subgraph is written in a form the builder does not edit. Change it in the Code tab.</p>}
                    <label className="builder-field">
                        <span>Title</span>
                        <input data-field="title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" disabled={!!readOnly} {...invalid('label')} />
                    </label>
                    <label className="builder-field">
                        <span>In subgraph</span>
                        <select data-field="parent" value={parent} onChange={(e) => setParent(e.target.value)} disabled={!!readOnly} {...invalid('parent', 'cycle')}>
                            <option value="">Top level</option>
                            {parent !== '' && !parents.some((g) => g.key === parent) && <option value={parent}>{parentName(parent)}</option>}
                            {parents.filter((g) => !sub || !subgraphsInside(model, sub.key).has(g.key)).map((g) => <option key={g.key} value={g.key}>{subgraphName(g)} ({g.key})</option>)}
                        </select>
                    </label>
                </>
            )}
            {kind === 'node' && (
                <>
                    <label className="builder-field">
                        <span>Label</span>
                        <input data-field="label" type="text" value={label} onChange={(e) => setLabel(e.target.value)} autoComplete="off" {...invalid('label')} />
                    </label>
                    <label className="builder-field">
                        <span>Shape</span>
                        <select data-field="shape" value={icon ? ICON : shape} onChange={(e) => setShape(e.target.value)} disabled={!!icon || shape === OTHER} {...invalid('invalid')}>
                            {icon && <option value={ICON}>Icon</option>}
                            {shape === OTHER && <option value={OTHER}>As written in the code</option>}
                            {SHAPES.map((s) => <option key={s.name} value={s.name}>{s.label}</option>)}
                        </select>
                    </label>
                    <div className="builder-field">
                        <label htmlFor={`${id}-icon`}>Icon</label>
                        <div className="builder-row">
                            <select data-field="icon" id={`${id}-icon`} value={icon} onChange={(e) => setIcon(e.target.value)} {...invalid('icon')}>
                                <option value="">None</option>
                                {icon && <option value={icon}>{icon}</option>}
                            </select>
                            {onChooseIcon && <button data-field="choose" type="button" className="example-btn" onClick={choose}>Choose from a pack…</button>}
                            {!onChooseIcon && onAddPack && <button data-field="add-pack" type="button" className="example-btn" onClick={(e) => onAddPack(e.currentTarget)}>Add an icon pack…</button>}
                        </div>
                    </div>
                    <label className="builder-field">
                        <span>In subgraph</span>
                        <select data-field="parent" value={parent} onChange={(e) => setParent(e.target.value)} {...invalid('parent')}>
                            <option value="">Top level</option>
                            {parent !== '' && !parents.some((g) => g.key === parent) && <option value={parent}>{parentName(parent)}</option>}
                            {parents.map((g) => <option key={g.key} value={g.key}>{subgraphName(g)} ({g.key})</option>)}
                        </select>
                    </label>
                </>
            )}
            {error && <p id={errorId} className="builder-error" role="alert">{error.message}</p>}
            <div className="builder-actions">
                <button data-field="submit" type="submit" className="icon-picker-primary" disabled={!!readOnly}>{adding ? 'Add' : 'Apply'}</button>
                {!adding && <button type="button" className="example-btn builder-danger" onClick={remove}>Delete</button>}
                {adding && <button type="button" className="example-btn" onClick={onCancel}>Cancel</button>}
            </div>
        </form>
    );
};

export default FlowchartForm;
