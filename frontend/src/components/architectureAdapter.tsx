import type { EditError } from '../utils/architectureModel';
import {
    connectNodes, directionOf, edges, findEdge, findNode, nodeName, nodeOutline, nodes, removeEdge, removeNode,
    type ArchitectureModel, type EdgeItem, type Side,
} from '../utils/architectureModel';
import { nodeAt, drawMarks, previewSides } from '../utils/architecturePreview';
import { DEFAULT_ICON, groupFor, quickAddService, replacesNothing } from '../utils/quickAdd';
import BuilderForm, { type FormTarget } from './BuilderForm';
import type { Adapter, BuilderSelection, Outcome, Row } from './builderTypes';

const SIDE_WORDS: Record<Side, string> = { L: 'left', R: 'right', T: 'top', B: 'bottom' };
const ARROWS = { none: '—', forward: '→', backward: '←', both: '↔' };

function edgeText(model: ArchitectureModel, edge: EdgeItem): string {
    const end = (id: string, side: Side) => {
        const n = findNode(model, id);
        return `${n ? nodeName(n) : id} (${SIDE_WORDS[side]})`;
    };
    return `${end(edge.from.id, edge.from.side)} ${ARROWS[directionOf(edge)]} ${end(edge.to.id, edge.to.side)}`;
}

/** Quick add of a service; also used on an empty editor, which becomes an architecture diagram. */
export function architectureQuickAdd(code: string, model: ArchitectureModel | null, choice: { label: string; icon: string | null }, selection: BuilderSelection | null): Outcome {
    const selectedId = selection?.kind === 'node' ? selection.id : null;
    const parent = model ? groupFor(model, selectedId) : null;
    const result = quickAddService(code, choice.label, choice.icon ?? DEFAULT_ICON, parent);
    const group = parent && model ? findNode(model, parent) : undefined;
    return {
        result,
        message: `Added ${choice.label.trim()}${group ? ` to ${nodeName(group)}` : ''}.`,
        select: result.ok && result.id ? { kind: 'node', id: result.id } : null,
    };
}

// The architecture builder: groups, services, junctions and connections with sides.
export function architectureAdapter(code: string, model: ArchitectureModel): Adapter {
    const nodeOf = (s: BuilderSelection | null) => (s?.kind === 'node' ? findNode(model, s.id) : undefined);
    const edgeOf = (s: BuilderSelection | null) => (s?.kind === 'edge' ? findEdge(model, s.line, s.text) : undefined);
    const isEndpoint = (id: string | null) => {
        const n = id !== null ? findNode(model, id) : undefined;
        return n !== undefined && n.kind !== 'group';
    };

    const nodeRows: Row[] = nodeOutline(model).map(({ node, depth }) => ({
        key: `n:${node.id}`, depth, selection: { kind: 'node', id: node.id }, tag: node.kind, label: nodeName(node),
        codes: [...(node.kind !== 'junction' && node.icon ? [node.icon] : []), ...(node.kind === 'service' && node.iconText !== null ? [`"${node.iconText}"`] : [])],
        target: node.id, field: node.kind === 'junction' ? 'parent' : 'label',
    }));
    const edgeRows: Row[] = edges(model).map((edge) => ({
        key: `e:${edge.line}`, depth: 0, selection: { kind: 'edge', line: edge.line, text: model.lines[edge.line] },
        label: edgeText(model, edge), codes: [], note: edge.label ?? undefined, target: null, field: 'From-node',
    }));

    return {
        kind: 'architecture',
        nodeRows,
        edgeRows,
        resolve: (s) => {
            const node = nodeOf(s);
            if (node) return { key: `n:${node.id}`, name: nodeName(node), isNode: true, connectable: node.kind !== 'group', formKey: `${node.kind}-${node.line}-${model.lines[node.line]}` };
            const edge = edgeOf(s);
            if (edge) return { key: `e:${edge.line}`, name: edgeText(model, edge), isNode: false, connectable: false, formKey: `edge-${edge.line}-${model.lines[edge.line]}` };
            return null;
        },
        isEndpoint,
        name: (id) => {
            const n = findNode(model, id);
            return n ? nodeName(n) : id;
        },
        placeName: (s) => {
            const place = groupFor(model, nodeOf(s)?.id ?? null);
            const group = place ? findNode(model, place) : undefined;
            return group ? nodeName(group) : null;
        },
        tools: [
            { label: 'Add service', what: 'service' },
            { label: 'Add group', what: 'group' },
            { label: 'Add junction', what: 'junction' },
            { label: 'Connect', what: 'edge' },
        ],
        addTarget: (what, s): FormTarget => {
            // A new node goes into the selected group (or the selected node's group).
            const selected = nodeOf(s);
            const parent = groupFor(model, selected?.id ?? null);
            const ends = nodes(model).filter((n) => n.kind !== 'group');
            const from = selected && selected.kind !== 'group' ? selected.id : ends[0]?.id ?? '';
            const to = ends.find((n) => n.id !== from)?.id ?? '';
            return what === 'edge' ? { mode: 'add', kind: 'edge', from, to } : { mode: 'add', kind: what as 'service' | 'group' | 'junction', parent };
        },
        editTarget: (s): FormTarget => ({ mode: 'edit', item: (nodeOf(s) ?? edgeOf(s))! }),
        renderForm: (key, p) => (
            <BuilderForm
                key={key}
                code={p.code}
                model={model}
                target={p.target as FormTarget}
                onChooseIcon={p.onChooseIcon}
                onAddPack={p.onAddPack}
                onDone={(result, select, message) => p.onDone(result, select, message) as EditError | null}
                onCancel={p.onCancel}
            />
        ),
        quickAdd: (choice, s) => architectureQuickAdd(code, model, choice, s),
        connectProblem: (s) => {
            const node = nodeOf(s);
            if (!node) return 'Select a service or junction first, then connect it.';
            if (node.kind === 'group') return 'A connection starts at a service or junction, not at a group.';
            if (!nodes(model).some((n) => n.kind !== 'group' && n.id !== node.id)) return 'Add another service first, then connect the two.';
            return null;
        },
        connect: (fromId, toId, svg) => {
            const from = findNode(model, fromId);
            const to = findNode(model, toId);
            if (!from || !to) return null;
            const sides = previewSides(svg, fromId, toId);
            return {
                result: connectNodes(code, fromId, toId, sides),
                message: `Connected ${nodeName(from)} (${SIDE_WORDS[sides.from]}) to ${nodeName(to)} (${SIDE_WORDS[sides.to]}).`,
                select: { kind: 'node', id: toId },
            };
        },
        remove: (s, confirmed) => {
            const edge = edgeOf(s);
            if (edge) return { result: removeEdge(code, edge.line), message: `Deleted the connection ${edgeText(model, edge)}.` };
            const node = nodeOf(s);
            if (!node) return null;
            const name = nodeName(node);
            const inside = nodes(model).filter((n) => n.parent === node.id).length;
            if (node.kind === 'group' && inside > 0 && confirmed !== node.id) {
                const parent = node.parent ? findNode(model, node.parent) : undefined;
                return { key: node.id, ask: `${name} holds ${inside === 1 ? '1 item' : `${inside} items`}. Press Delete again to delete the group; ${inside === 1 ? 'it moves' : 'they move'} to ${parent ? nodeName(parent) : 'the top level'}.` };
            }
            const touching = edges(model).filter((e) => e.from.id === node.id || e.to.id === node.id).length;
            const extra = touching === 0 ? '' : touching === 1 ? ' and its connection' : ` and its ${touching} connections`;
            return { result: removeNode(code, node.id), message: `Deleted ${name}${extra}.` };
        },
        hit: (svg, target, x, y) => {
            const id = nodeAt(svg, target, x, y);
            return id === null ? null : { kind: 'node', id };
        },
        endpointAt: (svg, target, x, y) => nodeAt(svg, target, x, y),
        drawMarks: (svg, s, connecting, target) => {
            drawMarks(svg, { selected: nodeOf(s)?.id ?? null, connecting: connecting !== null, target });
        },
        unmanaged: model.unmanaged.length === 0 ? null : model.unmanaged.length === 1
            ? '1 line is not managed by the builder. It is kept as it is and can be edited in the Code tab.'
            : `${model.unmanaged.length} lines are not managed by the builder. They are kept as they are and can be edited in the Code tab.`,
        texts: {
            noun: 'service',
            quickPlaceholder: 'Add a service: type a product or icon name',
            customNote: 'Built-in',
            customIcon: DEFAULT_ICON,
            noNodes: 'No groups or services yet. Type a product name in the field above, or start from a template below.',
            noEdges: 'No connections yet. Select a service and press C, then click another one.',
            selectHint: 'Select an item above or in the preview to edit it. Double-click a node to edit its label.',
        },
        keepsNothing: replacesNothing(code),
    };
}
