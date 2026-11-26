/**
 * The builder's quick add: one search over Mermaid's built-in icons and every installed pack's
 * catalog, and adding the chosen icon as a service (architecture) or a node (flowchart). Pure
 * functions, so they also run under `node --test`. Matches are text (official name, pack, technical
 * name); nothing here draws an icon.
 */
import { searchCatalog, diagramKind, type CatalogEntry } from './iconPicker.ts';
import {
    BUILTIN_ICONS, addNode, findNode, parseArchitecture, startArchitecture,
    type ArchitectureModel, type EditResult,
} from './architectureModel.ts';
import { addNode as addFlowNode, findNode as findFlowNode, findSubgraph, type FlowchartModel, type EditResult as FlowEditResult } from './flowchartModel.ts';

/** Where entries come from: a pack (its prefix and label) or Mermaid's built-in icons (prefix null). */
export interface IconSource { prefix: string | null; label: string; entries: readonly CatalogEntry[] }
export interface Match { prefix: string | null; source: string; entry: CatalogEntry }

/** The icon of a service added from text that matches nothing. */
export const DEFAULT_ICON = 'server';

export const BUILTIN_SOURCE: IconSource = {
    prefix: null,
    label: 'Built-in',
    entries: BUILTIN_ICONS.map((icon) => ({ icon, name: icon[0].toUpperCase() + icon.slice(1), group: null })),
};

/** The icon as written in the diagram: `cloud`, `gcp:cloud-run`. */
export const iconOf = (match: Match): string => (match.prefix ? `${match.prefix}:${match.entry.icon}` : match.entry.icon);

/**
 * The best `limit` matches over all sources, and how many there are. Entries are found with the icon
 * picker's search; across sources, an exact name comes first, then names that start with the query,
 * then names with a word that starts with it, then the rest. Within each, shorter names come first
 * ("AWS Lambda" before "S3 Object Lambda"), then source order and catalog order.
 */
export function searchSources(sources: readonly IconSource[], query: string, limit: number): { matches: Match[]; total: number } {
    const whole = query.toLowerCase().split(/\s+/).filter(Boolean).join(' ');
    if (whole === '') return { matches: [], total: 0 };
    const found: { match: Match; rank: number; order: number }[] = [];
    for (const source of sources) {
        for (const entry of searchCatalog(source.entries, whole)) {
            const name = entry.name.toLowerCase();
            const rank = name === whole ? 0 : name.startsWith(whole) ? 1 : name.includes(` ${whole}`) ? 2 : 3;
            found.push({ match: { prefix: source.prefix, source: source.label, entry }, rank, order: found.length });
        }
    }
    found.sort((a, b) => a.rank - b.rank || a.match.entry.name.length - b.match.entry.name.length || a.order - b.order);
    return { matches: found.slice(0, limit).map((f) => f.match), total: found.length };
}

/** The group a new node goes into: the selected group, or the group of the selected node; null is the top level. */
export function groupFor(model: ArchitectureModel, selectedId: string | null): string | null {
    const node = selectedId === null ? undefined : findNode(model, selectedId);
    if (!node) return null;
    return node.kind === 'group' ? node.id : node.parent;
}

/**
 * Add a service with this label and icon to group `parent`. An empty editor becomes an architecture
 * diagram first, in the same edit. The id is made from the label (see addNode).
 */
export function quickAddService(code: string, label: string, icon: string, parent: string | null): EditResult {
    const base = diagramKind(code) === 'empty' ? startArchitecture(code) : code;
    return addNode(base, 'service', { label, icon, parent });
}

/** Whether replacing `code` loses nothing: it is blank, or an architecture header and nothing else. */
export const replacesNothing = (code: string): boolean => {
    const text = code.trim();
    return text === '' || (parseArchitecture(code) !== null && /^architecture-beta$/.test(text));
};

/** The subgraph a new flowchart node goes into: the selected subgraph, or the subgraph of the selected node. */
export function subgraphFor(model: FlowchartModel, selectedId: string | null): string | null {
    if (selectedId === null) return null;
    const sub = findSubgraph(model, selectedId);
    if (sub) return sub.managed ? sub.key : null;
    const parent = findFlowNode(model, selectedId)?.parent ?? null;
    return parent && findSubgraph(model, parent)?.managed ? parent : null;
}

/**
 * Add a flowchart node with this label to subgraph `parent`: an icon node for a pack icon
 * (`id@{ icon: "gcp:cloud-run", label: "Cloud Run" }`), a rectangle (`id["Label"]`) without one.
 */
export function quickAddFlowNode(code: string, label: string, icon: string | null, parent: string | null): FlowEditResult {
    return addFlowNode(code, { label, icon, parent });
}
