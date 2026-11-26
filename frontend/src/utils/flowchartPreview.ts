/**
 * The builder's link to a rendered flowchart: what a click is on (a node, a connection or a
 * subgraph), and the marks drawn over the diagram.
 *
 * Mermaid 11 names what it draws after the render id (the id of the <svg> root):
 *   nodes        <g class="node …" id="{render}-flowchart-{id}-{n}">  (icon nodes: class "icon-shape")
 *   edges        <path data-edge="true" id="{render}-L_{from}_{to}_{n}">
 *   edge labels  <g class="edgeLabel"><g class="label" data-id="L_{from}_{to}_{n}">
 *   subgraphs    <g class="cluster" id="{render}-{subgraph id}">  (an empty one: <g class="node" id="…">)
 *
 * As for architecture diagrams, every mark is a separate element appended to the root with the class
 * `builder-overlay`; nothing Mermaid drew is changed, and no icon is touched.
 */
import { addMark, clearMarks, drawBoxMarks, elementBox, rootMatrix } from './architecturePreview.ts';
import type { FlowchartModel } from './flowchartModel.ts';

/** A node id, an edge key or a subgraph key, as the builder's selection names them. */
export type FlowHit = { kind: 'node'; id: string } | { kind: 'link'; key: string };

const nodePrefix = (svg: SVGSVGElement) => `${svg.id}-flowchart-`;
const nodeIdOf = (svg: SVGSVGElement, el: Element) => el.id.slice(nodePrefix(svg).length).replace(/-\d+$/, '');
const graphics = (el: Element | null | undefined) => (el instanceof SVGGraphicsElement ? el : null);

function nodeElements(svg: SVGSVGElement): Element[] {
    const prefix = nodePrefix(svg);
    return Array.from(svg.querySelectorAll('[id]')).filter((e) => e.id.startsWith(prefix) && /-\d+$/.test(e.id));
}

/** What a click at this point is on, or null (empty space, something the model does not have). */
export function flowHit(svg: SVGSVGElement, model: FlowchartModel, target: EventTarget | null, clientX: number, clientY: number): FlowHit | null {
    if (!svg.id) return null;
    const edgeByDom = (domId: string | undefined) => model.edges.find((e) => e.domId === domId);
    for (let el = target instanceof Element ? target : null; el && el !== svg; el = el.parentElement) {
        if (el.id.startsWith(nodePrefix(svg)) && /-\d+$/.test(el.id)) {
            const id = nodeIdOf(svg, el);
            if (model.nodes.some((n) => n.id === id)) return { kind: 'node', id };
        }
        if (el.classList.contains('edgeLabel')) {
            const edge = edgeByDom(el.querySelector<SVGElement>('[data-id]')?.dataset.id);
            if (edge) return { kind: 'link', key: edge.key };
        }
        if (el.getAttribute('data-edge') === 'true') {
            const edge = edgeByDom(el.id.slice(svg.id.length + 1));
            if (edge) return { kind: 'link', key: edge.key };
        }
        if (el.classList.contains('cluster') || el.classList.contains('node')) {
            const key = el.id.slice(svg.id.length + 1);
            if (model.subgraphs.some((g) => g.key === key)) return { kind: 'node', id: key };
        }
    }
    // Between the parts of a node (an icon's gaps, a label's background): the smallest node box
    // around the point, else the innermost subgraph box.
    const smallest = (els: Element[], idOf: (el: Element) => string) => {
        let best: string | null = null;
        let area = Infinity;
        for (const el of els) {
            const b = el.getBoundingClientRect();
            if (clientX >= b.left && clientX <= b.right && clientY >= b.top && clientY <= b.bottom && b.width * b.height < area) {
                best = idOf(el);
                area = b.width * b.height;
            }
        }
        return best;
    };
    const node = smallest(nodeElements(svg).filter((el) => model.nodes.some((n) => n.id === nodeIdOf(svg, el))), (el) => nodeIdOf(svg, el));
    if (node) return { kind: 'node', id: node };
    const clusters = Array.from(svg.querySelectorAll('g.cluster, g.node')).filter((el) => model.subgraphs.some((g) => g.key === el.id.slice(svg.id.length + 1)));
    const cluster = smallest(clusters, (el) => el.id.slice(svg.id.length + 1));
    return cluster ? { kind: 'node', id: cluster } : null;
}

function nodeElement(svg: SVGSVGElement, id: string) {
    return graphics(nodeElements(svg).find((el) => nodeIdOf(svg, el) === id));
}

function clusterElement(svg: SVGSVGElement, key: string) {
    return graphics(Array.from(svg.querySelectorAll('g.cluster, g.node')).find((el) => el.id === `${svg.id}-${key}`));
}

/** The box of a node or subgraph in the root's user space, or null. */
export function flowBox(svg: SVGSVGElement, id: string) {
    return elementBox(svg, nodeElement(svg, id) ?? clusterElement(svg, id));
}

export interface FlowMarks {
    selected: FlowHit | null;
    connecting: boolean;
    target: string | null;
}

/** Remove every mark, then draw `marks`. Returns whether the selected item was found. */
export function drawFlowMarks(svg: SVGSVGElement, model: FlowchartModel, marks: FlowMarks): boolean {
    clearMarks(svg);
    const sel = marks.selected;
    if (!sel) return false;
    if (sel.kind === 'node') {
        const target = marks.connecting && marks.target && marks.target !== sel.id ? flowBox(svg, marks.target) : null;
        return drawBoxMarks(svg, flowBox(svg, sel.id), marks.connecting, target);
    }
    const edge = model.edges.find((e) => e.key === sel.key);
    if (!edge) return false;
    // A connection: its line traced over in the selection colour, and its label outlined.
    const path = graphics(svg.querySelector(`path[data-edge="true"][id="${CSS.escape(`${svg.id}-${edge.domId}`)}"]`));
    const d = path?.getAttribute('d');
    const matrix = path ? rootMatrix(svg, path) : null;
    if (path && d && matrix) {
        const { a, b, c, d: dd, e, f } = matrix;
        addMark(svg, 'path', 'builder-selection-edge', { d, transform: `matrix(${a},${b},${c},${dd},${e},${f})` });
    }
    const label = graphics(svg.querySelector(`.edgeLabel [data-id="${CSS.escape(edge.domId)}"]`)?.closest('.edgeLabel'));
    const box = label && label.textContent?.trim() ? elementBox(svg, label) : null;
    if (box && box.width > 0) drawBoxMarks(svg, box, false, null);
    return !!(d || box);
}
