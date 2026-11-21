import React, { useId, useState } from 'react';
import type { CatalogEntry } from '../utils/iconPicker';
import {
    BUILTIN_ICONS, SIDES, addEdge, addNode, arrowsOf, directionOf, nodeName, nodes, parentChoices, removeEdge, removeNode,
    updateEdge, updateNode,
    type ArchitectureModel, type Direction, type EdgeItem, type EditError, type EditResult, type NodeItem, type NodeKind, type Side,
} from '../utils/architectureModel';

/** What the form edits: a new item (with the values to start from) or an item of the diagram. */
export type FormTarget =
    | { mode: 'add'; kind: NodeKind; parent: string | null }
    | { mode: 'add'; kind: 'edge'; from: string; to: string }
    | { mode: 'edit'; item: NodeItem | EdgeItem };

/** The result of an action and what to select after it; returns the error to show, if any. */
export type Done = (result: EditResult, select: { kind: 'node'; id: string } | { kind: 'edge'; line: number } | null, message: string) => EditError | null;

interface Props {
    code: string;
    model: ArchitectureModel;
    target: FormTarget;
    /** Opens the icon picker in choosing mode (focus goes back to `opener`); absent when no pack is installed. */
    onChooseIcon?: (onChoose: (prefix: string, entry: CatalogEntry) => void, opener: HTMLElement) => void;
    /** Opens the "How to add an icon pack" help (focus goes back to `opener`); offered when no pack is installed. */
    onAddPack?: (opener: HTMLElement) => void;
    onDone: Done;
    onCancel: () => void;
}

const SIDE_NAMES: Record<Side, string> = { L: 'Left', R: 'Right', T: 'Top', B: 'Bottom' };
const DIRECTIONS: { value: Direction; label: string }[] = [
    { value: 'none', label: 'No arrow' },
    { value: 'forward', label: 'Forward (arrow at "to")' },
    { value: 'backward', label: 'Backward (arrow at "from")' },
    { value: 'both', label: 'Both ways' },
];
// Select value for a service whose icon is a quoted text: kept unless another icon is chosen.
const ICON_TEXT = ':text';

// Editor of one group, service, junction or connection. Values are text in form fields; the icon is
// a name (`cloud`, `gcp:cloud-run`), never a picture.
const BuilderForm: React.FC<Props> = ({ code, model, target, onChooseIcon, onAddPack, onDone, onCancel }) => {
    const id = useId();
    const [error, setError] = useState<EditError | null>(null);
    const adding = target.mode === 'add';
    const kind = target.mode === 'add' ? target.kind : target.item.kind;
    const item = target.mode === 'edit' ? target.item : null;
    const node = item && item.kind !== 'edge' ? item : null;
    const edge = item && item.kind === 'edge' ? item : null;

    // Node fields.
    const iconStart = node && node.kind !== 'junction' ? (node.kind === 'service' && node.iconText !== null ? ICON_TEXT : node.icon ?? '') : '';
    const [label, setLabel] = useState(node && node.kind !== 'junction' ? node.label ?? '' : '');
    const [icon, setIcon] = useState(iconStart);
    const [parent, setParent] = useState(node ? node.parent ?? '' : target.mode === 'add' && target.kind !== 'edge' ? target.parent ?? '' : '');
    // Connection fields.
    const [fromId, setFromId] = useState(edge ? edge.from.id : target.mode === 'add' && target.kind === 'edge' ? target.from : '');
    const [toId, setToId] = useState(edge ? edge.to.id : target.mode === 'add' && target.kind === 'edge' ? target.to : '');
    const [fromSide, setFromSide] = useState<Side>(edge ? edge.from.side : 'R');
    const [toSide, setToSide] = useState<Side>(edge ? edge.to.side : 'L');
    const [direction, setDirection] = useState<Direction>(edge ? directionOf(edge) : 'forward');
    const [edgeLabel, setEdgeLabel] = useState(edge?.label ?? '');

    const endpoints = nodes(model).filter((n) => n.kind !== 'group');
    const groups = parentChoices(model, node ? node.id : null);
    const iconOptions = [...BUILTIN_ICONS, ...(icon && icon !== ICON_TEXT && !BUILTIN_ICONS.includes(icon) ? [icon] : [])];
    const kindName = kind === 'edge' ? 'connection' : kind;

    const show = (result: EditError | null) => setError(result);

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        if (kind === 'edge') {
            const arrows = arrowsOf(direction);
            const spec = { from: { id: fromId, side: fromSide, arrow: arrows.from }, to: { id: toId, side: toSide, arrow: arrows.to }, label: edgeLabel };
            const result = edge ? updateEdge(code, edge.line, spec) : addEdge(code, spec);
            const line = result.ok ? result.line ?? null : null;
            show(onDone(result, line === null ? null : { kind: 'edge', line }, edge ? 'Connection updated.' : 'Connection added.'));
            return;
        }
        const iconValue = icon === ICON_TEXT ? undefined : icon || null;
        // A node written without a title keeps it that way while its label field stays empty.
        const keepNoLabel = node !== null && node.kind !== 'junction' && node.label === null && label.trim() === '';
        const spec = kind === 'junction' ? { parent: parent || null } : { label: keepNoLabel ? undefined : label, icon: iconValue, parent: parent || null };
        const result = node ? updateNode(code, node.id, spec) : addNode(code, kind, spec);
        const name = kind === 'junction' ? (result.ok ? result.id : '') : label.trim();
        show(onDone(result, result.ok && result.id ? { kind: 'node', id: result.id } : null, `${node ? 'Updated' : 'Added'} ${name}.`));
    };

    const remove = () => {
        if (edge) show(onDone(removeEdge(code, edge.line), null, 'Connection deleted.'));
        else if (node) {
            const touching = model.items.filter((i) => i.kind === 'edge' && (i.from.id === node.id || i.to.id === node.id)).length;
            const extra = touching === 0 ? '' : touching === 1 ? ' and its connection' : ` and its ${touching} connections`;
            show(onDone(removeNode(code, node.id), null, `Deleted ${nodeName(node)}${extra}.`));
        }
    };

    const choose = (e: React.MouseEvent<HTMLButtonElement>) => onChooseIcon?.((prefix, entry) => {
        setIcon(`${prefix}:${entry.icon}`);
        setLabel((current) => (current.trim() ? current : entry.name));
        setError(null);
    }, e.currentTarget);

    const errorId = `${id}-error`;
    const invalid = (...codes: EditError['code'][]) => (error && codes.includes(error.code) ? { 'aria-invalid': true, 'aria-describedby': errorId } : {});
    const endpointSelect = (value: string, set: (v: string) => void, side: Side, setSide: (s: Side) => void, which: 'From' | 'To') => (
        <fieldset className="builder-fieldset">
            <legend>{which}</legend>
            <div className="builder-row">
                <select data-field={`${which}-node`} aria-label={`${which} node`} value={value} onChange={(e) => set(e.target.value)} {...invalid('endpoint')}>
                    {value === '' && <option value="">Choose a node</option>}
                    {endpoints.map((n) => <option key={n.id} value={n.id}>{nodeName(n)} ({n.id})</option>)}
                </select>
                <select data-field={`${which}-side`} aria-label={`${which} side`} value={side} onChange={(e) => setSide(e.target.value as Side)}>
                    {SIDES.map((s) => <option key={s} value={s}>{SIDE_NAMES[s]}</option>)}
                </select>
            </div>
        </fieldset>
    );

    return (
        <form className="builder-form" onSubmit={submit} aria-labelledby={`${id}-title`} noValidate>
            <h3 id={`${id}-title`}>
                {adding ? `New ${kindName}` : node ? `${kind[0].toUpperCase()}${kind.slice(1)} ` : 'Connection'}
                {node && <code>{node.id}</code>}
            </h3>
            {kind === 'edge' ? (
                <>
                    {endpoints.length < 2 && <p className="builder-hint">A connection joins two services or junctions. Add them first.</p>}
                    {endpointSelect(fromId, setFromId, fromSide, setFromSide, 'From')}
                    {endpointSelect(toId, setToId, toSide, setToSide, 'To')}
                    <label className="builder-field">
                        <span>Direction</span>
                        <select data-field="direction" value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
                            {DIRECTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                        </select>
                    </label>
                    <label className="builder-field">
                        <span>Label (optional)</span>
                        <input data-field="edge-label" type="text" value={edgeLabel} onChange={(e) => setEdgeLabel(e.target.value)} autoComplete="off" {...invalid('label')} />
                    </label>
                </>
            ) : (
                <>
                    {kind !== 'junction' && (
                        <>
                            <label className="builder-field">
                                <span>Label</span>
                                <input data-field="label" type="text" value={label} onChange={(e) => setLabel(e.target.value)} autoComplete="off" {...invalid('label')} />
                            </label>
                            <div className="builder-field">
                                <label htmlFor={`${id}-icon`}>Icon</label>
                                <div className="builder-row">
                                    <select data-field="icon" id={`${id}-icon`} value={icon} onChange={(e) => setIcon(e.target.value)} {...invalid('icon')}>
                                        <option value="">None</option>
                                        {node?.kind === 'service' && node.iconText !== null && <option value={ICON_TEXT}>Text: {node.iconText}</option>}
                                        {iconOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                                    </select>
                                    {onChooseIcon && <button data-field="choose" type="button" className="example-btn" onClick={choose}>Choose from a pack…</button>}
                                    {!onChooseIcon && onAddPack && <button data-field="add-pack" type="button" className="example-btn" onClick={(e) => onAddPack(e.currentTarget)}>Add an icon pack…</button>}
                                </div>
                            </div>
                        </>
                    )}
                    <label className="builder-field">
                        <span>In group</span>
                        <select data-field="parent" value={parent} onChange={(e) => setParent(e.target.value)} {...invalid('parent', 'cycle')}>
                            <option value="">Top level</option>
                            {groups.map((g) => <option key={g.id} value={g.id}>{nodeName(g)} ({g.id})</option>)}
                        </select>
                    </label>
                </>
            )}
            {error && <p id={errorId} className="builder-error" role="alert">{error.message}</p>}
            <div className="builder-actions">
                <button data-field="submit" type="submit" className="icon-picker-primary">{adding ? 'Add' : 'Apply'}</button>
                {!adding && <button type="button" className="example-btn builder-danger" onClick={remove}>Delete</button>}
                {adding && <button type="button" className="example-btn" onClick={onCancel}>Cancel</button>}
            </div>
        </form>
    );
};

export default BuilderForm;
