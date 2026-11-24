/**
 * The size at which the preview shows a rendered diagram: the drawing area Mermaid chose (the
 * viewBox of its SVG), at one screen pixel per unit. The export shows the same area.
 *
 * The size is not measured from what is drawn. Mermaid draws some things outside the area on
 * purpose: the "today" line of a Gantt chart sits where today falls on the time axis, which can be
 * tens of thousands of units from a chart whose dates are in another year.
 */

export interface Area {
    width: number;
    height: number;
}

/** Width and height of a viewBox attribute, or null when it has none that can be shown. */
export function drawingArea(viewBox: string | null | undefined): Area | null {
    const parts = (viewBox ?? '').trim().split(/[\s,]+/).map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
    const [, , width, height] = parts;
    return width > 0 && height > 0 ? { width, height } : null;
}

/** Give the rendered SVG the size of its drawing area, whatever size Mermaid asked for. */
export function showAtNaturalSize(svg: SVGSVGElement): void {
    let area = drawingArea(svg.getAttribute('viewBox'));
    if (!area) {
        // No usable viewBox (no diagram kind in Mermaid 11 does this): show everything that is drawn.
        const box = svg.getBBox();
        if (box.width > 0 && box.height > 0) {
            svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
            area = { width: box.width, height: box.height };
        }
    }
    if (area) {
        svg.setAttribute('width', String(area.width));
        svg.setAttribute('height', String(area.height));
    }
    // Some diagram kinds ask for "100%" of the container with a max-width; the preview scrolls instead.
    svg.style.maxWidth = 'none';
    svg.style.maxHeight = 'none';
    svg.style.width = 'auto';
    svg.style.height = 'auto';
}
