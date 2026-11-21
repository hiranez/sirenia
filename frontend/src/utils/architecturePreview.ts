/**
 * The builder's link to the rendered preview: which architecture node a click is on, and the outline
 * around the selected node.
 *
 * Mermaid names what it draws after the render id (the id of the <svg> root) and the node id:
 *   services   <g id="{render}-service-{id}" class="architecture-service">
 *   junctions  <g class="architecture-junction"><g><rect id="{render}-node-{id}"></g></g>
 *   groups     <rect id="{render}-group-{id}" class="node-bkg">
 * Labels and group icons are siblings without an id, so a click that is not on a service or a junction
 * picks the innermost group box around the point.
 *
 * Icon artwork is shown unmodified: the outline is a separate <rect> appended to the root, around the
 * node's box, and nothing Mermaid drew is changed.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const OUTLINE_CLASS = 'builder-selection-outline';
const PAD = 6;

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
    let best: string | null = null;
    let bestArea = Infinity;
    for (const el of withId(svg)) {
        if (!el.id.startsWith(p.group)) continue;
        const box = el.getBoundingClientRect();
        const area = box.width * box.height;
        if (clientX >= box.left && clientX <= box.right && clientY >= box.top && clientY <= box.bottom && area < bestArea) {
            best = el.id.slice(p.group.length);
            bestArea = area;
        }
    }
    return best;
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

/** Remove the outline, and draw it around node `id` when given. Returns whether a node was found. */
export function showSelection(svg: SVGSVGElement, id: string | null): boolean {
    svg.querySelectorAll(`.${OUTLINE_CLASS}`).forEach((el) => el.remove());
    const el = id === null ? null : nodeElement(svg, id);
    const root = svg.getScreenCTM();
    const own = el?.getScreenCTM();
    if (!el || !root || !own) return false;

    // The node's box in the root's user space (it sits inside transformed groups).
    const toRoot = root.inverse().multiply(own);
    const box = el.getBBox();
    const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]
        .map(([x, y]) => new DOMPoint(x, y).matrixTransform(toRoot));
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const x = Math.min(...xs) - PAD;
    const y = Math.min(...ys) - PAD;

    const outline = document.createElementNS(SVG_NS, 'rect');
    outline.setAttribute('class', OUTLINE_CLASS);
    outline.setAttribute('x', String(x));
    outline.setAttribute('y', String(y));
    outline.setAttribute('width', String(Math.max(...xs) + PAD - x));
    outline.setAttribute('height', String(Math.max(...ys) + PAD - y));
    outline.setAttribute('rx', '6');
    outline.setAttribute('aria-hidden', 'true');
    // Inline, so that the diagram's own stylesheet (which styles its rects) does not apply.
    outline.style.cssText = 'fill: none; stroke: #6366f1; stroke-width: 3px; stroke-dasharray: 6 4; pointer-events: none;';
    svg.appendChild(outline);
    return true;
}
