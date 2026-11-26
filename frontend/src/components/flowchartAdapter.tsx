import {
    FLOW_DIRECTIONS, SHAPES, connectNodes, findEdge, findNode, findSubgraph, flowOutline, itemName, nodeName, removeEdge, removeNode,
    removeSubgraph, setDirection, subgraphName, type FlowDirection, type FlowEdge, type FlowchartModel,
} from '../utils/flowchartModel';
import { drawFlowMarks, flowHit } from '../utils/flowchartPreview';
import { quickAddFlowNode, subgraphFor } from '../utils/quickAdd';
import { alsoText, deletedText } from '../utils/flowchartText';
import FlowchartForm, { type FlowTarget } from './FlowchartForm';
import type { Adapter, BuilderSelection, Row } from './builderTypes';

/** The direction control: an arrow for each direction, named in words. */
const DIRECTION_SYMBOLS: Record<string, string> = { TD: '↓', BT: '↑', LR: '→', RL: '←' };
const arrow = (e: FlowEdge) => (e.startHead && e.endHead ? '↔' : e.endHead ? '→' : e.startHead ? '←' : '—');
const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

// The flowchart builder: nodes with shapes or icons, subgraphs, connections with labels.
export function flowchartAdapter(code: string, model: FlowchartModel, hasPacks: boolean): Adapter {
    const idOf = (s: BuilderSelection | null) => (s?.kind === 'node' ? s.id : null);
    const nodeOf = (s: BuilderSelection | null) => (s?.kind === 'node' ? findNode(model, s.id) : undefined);
    const subOf = (s: BuilderSelection | null) => (s?.kind === 'node' ? findSubgraph(model, s.id) : undefined);
    const edgeOf = (s: BuilderSelection | null) => (s?.kind === 'link' ? findEdge(model, s.key) : undefined);
    const edgeText = (e: FlowEdge) => `${itemName(model, e.from)} ${arrow(e)} ${itemName(model, e.to)}`;
    const shapeLabel = (shape: string) => SHAPES.find((s) => s.name === shape)?.label;

    const nodeRows: Row[] = flowOutline(model).map((item) => (item.kind === 'subgraph'
        ? {
            key: `s:${item.subgraph.key}`, depth: item.depth, selection: { kind: 'node', id: item.subgraph.key }, tag: 'subgraph',
            label: subgraphName(item.subgraph), codes: [], note: item.subgraph.managed ? undefined : 'Code tab', target: item.subgraph.key, field: 'title',
        }
        : {
            key: `n:${item.node.id}`, depth: item.depth, selection: { kind: 'node', id: item.node.id }, tag: 'node', label: nodeName(item.node),
            codes: item.node.icon ? [item.node.icon] : [], note: item.node.shape === 'rect' || item.node.icon ? undefined : shapeLabel(item.node.shape),
            target: item.node.id, field: 'label',
        }));
    const edgeRows: Row[] = model.edges.map((e) => ({
        key: `l:${e.key}`, depth: 0, selection: { kind: 'link', key: e.key }, label: edgeText(e), codes: [], note: e.label ?? undefined, target: null, field: 'edge-label',
    }));
    const direction = model.direction === 'TB' || model.direction === null ? 'TD' : model.direction;
    const known = FLOW_DIRECTIONS.some((d) => d.value === direction);
    const holds = (key: string) => model.nodes.filter((n) => n.parent === key).length + model.subgraphs.filter((g) => g.parent === key).length;

    return {
        kind: 'flowchart',
        nodeRows,
        edgeRows,
        resolve: (s) => {
            const node = nodeOf(s);
            if (node) return { key: `n:${node.id}`, name: nodeName(node), isNode: true, connectable: true, formKey: `node-${JSON.stringify([node.id, node.label, node.shape, node.icon, node.parent])}` };
            const sub = subOf(s);
            if (sub) return { key: `s:${sub.key}`, name: subgraphName(sub), isNode: true, connectable: false, formKey: `sub-${JSON.stringify([sub.key, sub.title, sub.parent])}` };
            const edge = edgeOf(s);
            if (edge) return { key: `l:${edge.key}`, name: edgeText(edge), isNode: false, connectable: false, formKey: `link-${JSON.stringify([edge.key, edge.label, edge.stroke, edge.endHead])}` };
            return null;
        },
        isEndpoint: (id) => id !== null && findNode(model, id) !== undefined,
        name: (id) => itemName(model, id),
        placeName: (s) => {
            const key = subgraphFor(model, idOf(s));
            return key ? subgraphName(findSubgraph(model, key)!) : null;
        },
        tools: [
            { label: 'Add node', what: 'node' },
            { label: 'Add subgraph', what: 'subgraph' },
            { label: 'Connect', what: 'edge' },
        ],
        toolChoice: {
            label: 'Direction',
            value: known ? direction : null,
            options: FLOW_DIRECTIONS.map((d) => ({ value: d.value, label: d.label, symbol: DIRECTION_SYMBOLS[d.value] })),
            set: (value) => ({
                result: setDirection(code, value as FlowDirection),
                message: `Direction: ${FLOW_DIRECTIONS.find((d) => d.value === value)!.label.toLowerCase()}.`,
            }),
        },
        addTarget: (what, s): FlowTarget => {
            const parent = subgraphFor(model, idOf(s));
            if (what !== 'edge') return { mode: 'add', kind: what as 'node' | 'subgraph', parent };
            const selected = nodeOf(s);
            const from = selected?.id ?? model.nodes[0]?.id ?? '';
            const to = model.nodes.find((n) => n.id !== from)?.id ?? '';
            return { mode: 'add', kind: 'edge', from, to };
        },
        editTarget: (s): FlowTarget => ({ mode: 'edit', selection: s }),
        renderForm: (key, p) => <FlowchartForm key={key} {...p} model={model} target={p.target as FlowTarget} />,
        quickAdd: (choice, s) => {
            const parent = subgraphFor(model, idOf(s));
            const result = quickAddFlowNode(code, choice.label, choice.icon, parent);
            const sub = parent ? findSubgraph(model, parent) : undefined;
            return {
                result,
                message: `Added ${choice.label.trim()}${sub ? ` to ${subgraphName(sub)}` : ''}.`,
                select: result.ok && result.id ? { kind: 'node', id: result.id } : null,
            };
        },
        connectProblem: (s) => {
            if (subOf(s)) return 'A connection starts at a node, not at a subgraph.';
            const node = nodeOf(s);
            if (!node) return 'Select a node first, then connect it.';
            if (!model.nodes.some((n) => n.id !== node.id)) return 'Add another node first, then connect the two.';
            return null;
        },
        afterEdit: alsoText,
        connect: (fromId, toId) => {
            const from = findNode(model, fromId);
            if (!from) return null;
            if (!findNode(model, toId)) {
                if (!findSubgraph(model, toId)) return null;
                return { result: { ok: false, error: { code: 'endpoint', message: 'A connection made by clicking joins two nodes, not a subgraph. Use Connect for that, or choose a node.' } }, message: '' };
            }
            const result = connectNodes(code, fromId, toId);
            // Many connections of a flowchart carry a label ("Yes", "No"): its field comes next.
            return {
                result,
                message: `Connected ${nodeName(from)} to ${itemName(model, toId)}. Type a label if it needs one, then press Enter.`,
                select: result.ok && result.key ? { kind: 'link', key: result.key } : null,
                field: 'edge-label',
            };
        },
        remove: (s, confirmed) => {
            // Lines the builder cannot read that name the item: a second Delete deletes them too.
            const linesKey = (id: string) => `lines:${id}`;
            const ask = (result: ReturnType<typeof removeNode>, id: string) => (!result.ok && result.error.code === 'confirm' ? { key: linesKey(id), ask: result.error.message } : null);
            const edge = edgeOf(s);
            if (edge) {
                const result = removeEdge(code, edge.key);
                return { result, message: deletedText(`the connection ${edgeText(edge)}`, 0, result.ok ? result.also : undefined) };
            }
            const sub = subOf(s);
            if (sub) {
                const inside = holds(sub.key);
                if (inside > 0 && confirmed !== sub.key && confirmed !== linesKey(sub.key)) {
                    const parent = sub.parent ? findSubgraph(model, sub.parent) : undefined;
                    return { key: sub.key, ask: `${subgraphName(sub)} holds ${plural(inside, 'item', 'items')}. Press Delete again to delete the subgraph; ${inside === 1 ? 'it moves' : 'they move'} to ${parent ? subgraphName(parent) : 'the top level'}.` };
                }
                const result = removeSubgraph(code, sub.key, confirmed === linesKey(sub.key));
                const touching = model.edges.filter((e) => e.from === sub.key || e.to === sub.key).length;
                return ask(result, sub.key) ?? { result, message: deletedText(subgraphName(sub), touching, result.ok ? result.also : undefined) };
            }
            const node = nodeOf(s);
            if (!node) return null;
            const result = removeNode(code, node.id, confirmed === linesKey(node.id));
            const touching = model.edges.filter((e) => e.from === node.id || e.to === node.id).length;
            return ask(result, node.id) ?? { result, message: deletedText(nodeName(node), touching, result.ok ? result.also : undefined) };
        },
        hit: (svg, target, x, y) => flowHit(svg, model, target, x, y),
        endpointAt: (svg, target, x, y) => {
            const hit = flowHit(svg, model, target, x, y);
            return hit?.kind === 'node' ? hit.id : null;
        },
        drawMarks: (svg, s, connecting, target) => {
            const selected = s?.kind === 'node' || s?.kind === 'link' ? s : null;
            drawFlowMarks(svg, model, { selected, connecting: connecting !== null, target });
        },
        unmanaged: model.unmanaged.length === 0 ? null : model.unmanaged.length === 1
            ? '1 other line is edited in the Code tab.'
            : `${model.unmanaged.length} other lines are edited in the Code tab.`,
        texts: {
            noun: 'node',
            quickPlaceholder: hasPacks ? 'Add a node: type a label or a product name' : 'Add a node: type its label',
            customNote: 'Rectangle',
            customIcon: null,
            noNodes: 'No nodes yet. Type a label in the field above, or start from a template below.',
            noEdges: 'No connections yet. Select a node and press C, then click another one.',
            selectHint: 'Select an item above or in the preview to edit it. Double-click a node or a connection label to edit its label.',
        },
        keepsNothing: code.trim() === '' || /^(?:graph|flowchart)(?:[\t ]+\w+)?;?$/.test(code.trim()),
    };
}
