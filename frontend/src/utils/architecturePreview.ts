/**
 * The builder's link to the rendered preview: which architecture node a click is on, where a node
 * is, and the marks drawn over the diagram (the selection outline, and in connect mode the source,
 * the candidate target and the line that would join them).
 *
 * Mermaid names what it draws after the render id (the id of the <svg> root) and the node id:
 *   services   <g id="{render}-service-{id}" class="architecture-service">
 *   junctions  <g class="architecture-junction"><g><rect id="{render}-node-{id}"></g></g>
 *   groups     <rect id="{render}-group-{id}" class="node-bkg">
 * Labels and group icons are siblings without an id, so a click that is not on a service or a junction
 * picks the innermost group box around the point.
 *
 * Icon artwork is shown unmodified: every mark is a separate element appended to the root, with the
 * class `builder-overlay` and its own class (styled in index.css); nothing Mermaid drew is changed.
 */
import { sidesBetween, type Box, type Side } from './architectureModel.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const OVERLAY_CLASS = 'builder-overlay';
const PAD = 6;
const MARKER_RADIUS = 10;

const prefixes = (svg: SVGSVGElement) => ({
    service: `${svg.id}-service-`,
    node: `${svg.id}-node-`,
    group: `${svg.id}-group-`,
});

const withId = (svg: SVGSVGElement): Element[] => Array.from(svg.querySelectorAll('[id]'));

/** The model id of the node at a click, or null (empty space, an edge, another diagram kind). */
export function nodeAt(svg: SVGSVGElement, target: EventTarget | null, clientX: number, clientY: number): string | null {
    if (!svg.id) return null;
    const p = prefixes(svg);
    for (let el = target instanceof Element ? target : null; el && el !== svg; el = el.parentElement) {
        if (el.id.startsWith(p.service)) return el.id.slice(p.service.length);
        if (el.id.startsWith(p.node) && el.closest('.architecture-junction')) return el.id.slice(p.node.length);
    }
    // Not on a drawn part (a gap in an icon, a label's background, a group's box): the smallest
    // service or junction box around the point, else the innermost group box.
    const within = (prefix: string, junction: boolean) => {
        let best: string | null = null;
        let bestArea = Infinity;
        for (const el of withId(svg)) {
            if (!el.id.startsWith(prefix) || (junction && !el.closest('.architecture-junction'))) continue;
            const box = el.getBoundingClientRect();
            const area = box.width * box.height;
            if (clientX >= box.left && clientX <= box.right && clientY >= box.top && clientY <= box.bottom && area < bestArea) {
                best = el.id.slice(prefix.length);
                bestArea = area;
            }
        }
        return best;
    };
    return within(p.service, false) ?? within(p.node, true) ?? within(p.group, false);
}

function nodeElement(svg: SVGSVGElement, id: string): SVGGraphicsElement | null {
    const p = prefixes(svg);
    const wanted = [`${p.service}${id}`, `${p.group}${id}`, `${p.node}${id}`];
    const all = withId(svg);
    for (const name of wanted) {
        const el = all.find((e) => e.id === name);
        if (el instanceof SVGGraphicsElement) return el;
    }
    return null;
}

/** Node `id`'s box in the root's user space (it sits inside transformed groups), or null. */
export function nodeBox(svg: SVGSVGElement, id: string): Box | null {
    const el = nodeElement(svg, id);
    const root = svg.getScreenCTM();
    const own = el?.getScreenCTM();
    if (!el || !root || !own) return null;
    const toRoot = root.inverse().multiply(own);
    const box = el.getBBox();
    const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]
        .map(([x, y]) => new DOMPoint(x, y).matrixTransform(toRoot));
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** What to mark: the selected node; in connect mode it is the source, and `target` the node under the pointer or focus. */
export interface Marks {
    selected: string | null;
    connecting?: boolean;
    target?: string | null;
}

function element(parent: Element, tag: string, attrs: Record<string, string | number>): SVGElement {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
    parent.appendChild(el);
    return el;
}

const add = (svg: SVGSVGElement, tag: string, className: string, attrs: Record<string, string | number>) =>
    element(svg, tag, { class: `${OVERLAY_CLASS} ${className}`, 'aria-hidden': 'true', ...attrs });

const padded = (b: Box) => ({ x: b.x - PAD, y: b.y - PAD, width: b.width + 2 * PAD, height: b.height + 2 * PAD });

function anchor(b: Box, side: Side): [number, number] {
    const p = padded(b);
    if (side === 'L') return [p.x, p.y + p.height / 2];
    if (side === 'R') return [p.x + p.width, p.y + p.height / 2];
    if (side === 'T') return [p.x + p.width / 2, p.y];
    return [p.x + p.width / 2, p.y + p.height];
}

/** Remove every mark, then draw `marks`. Returns whether the selected node was found. */
export function drawMarks(svg: SVGSVGElement, marks: Marks): boolean {
    svg.querySelectorAll(`.${OVERLAY_CLASS}`).forEach((el) => el.remove());
    const source = marks.selected === null ? null : nodeBox(svg, marks.selected);
    if (!source) return false;
    const box = padded(source);
    const rect = { x: box.x, y: box.y, width: box.width, height: box.height, rx: 8 };
    add(svg, 'rect', marks.connecting ? 'builder-selection-outline connect-source' : 'builder-selection-outline', rect);
    if (!marks.connecting) return true;

    // "Connect from": a badge with an arrow on the source's top right corner.
    const cx = box.x + box.width;
    const cy = box.y;
    const r = MARKER_RADIUS;
    const marker = add(svg, 'g', 'builder-connect-marker', {});
    element(marker, 'circle', { cx, cy, r });
    element(marker, 'path', { d: `M${cx - r * 0.5},${cy} H${cx + r * 0.45} M${cx + r * 0.05},${cy - r * 0.4} L${cx + r * 0.45},${cy} L${cx + r * 0.05},${cy + r * 0.4}` });

    const target = marks.target && marks.target !== marks.selected ? nodeBox(svg, marks.target) : null;
    if (!target) return true;
    const t = padded(target);
    add(svg, 'rect', 'builder-connect-target', { x: t.x, y: t.y, width: t.width, height: t.height, rx: 8 });
    const sides = sidesBetween(source, target);
    const [x1, y1] = anchor(source, sides.from);
    const [x2, y2] = anchor(target, sides.to);
    add(svg, 'path', 'builder-connect-hint', { d: `M${x1},${y1} L${x2},${y2}` });
    // Arrowhead at the target end.
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = (a: number) => `${x2 - 11 * Math.cos(angle + a)},${y2 - 11 * Math.sin(angle + a)}`;
    add(svg, 'path', 'builder-connect-head', { d: `M${x2},${y2} L${head(0.45)} L${head(-0.45)} Z` });
    return true;
}

/** The sides a connection from `fromId` to `toId` takes in the rendered preview; R to L when either is not drawn. */
export function previewSides(svg: SVGSVGElement | null | undefined, fromId: string, toId: string): { from: Side; to: Side } {
    const a = svg ? nodeBox(svg, fromId) : null;
    const b = svg ? nodeBox(svg, toId) : null;
    return a && b ? sidesBetween(a, b) : { from: 'R', to: 'L' };
}
