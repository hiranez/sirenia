/**
 * Status line texts for flowchart edits that change attached lines too: "Deleted Start, its 2
 * connections and 1 style line." Pure, so they also run under `node --test`.
 */
import type { Also } from './flowchartModel.ts';

const n = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${count} ${many}`);
const KEYWORDS = ['style', 'class', 'click', 'linkStyle'] as const;

/** "a", "a and b", "a, b and c". */
export const joinAnd = (parts: string[]) => (parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`);

/** What else was deleted, as parts of a list: "1 style line", "its direction line", "line 7". */
export function alsoDeleted(also?: Also): string[] {
    if (!also) return [];
    const parts: string[] = KEYWORDS.filter((k) => also.deleted[k]).map((k) => n(also.deleted[k], `${k} line`, `${k} lines`));
    if (also.deleted.direction) parts.push('its direction line');
    if (also.lines.length) parts.push(also.lines.length === 1 ? `line ${also.lines[0] + 1}` : `lines ${joinAnd(also.lines.map((l) => String(l + 1)))}`);
    return parts;
}

/** " Updated 1 class line and 1 linkStyle line." or ''. */
export function alsoUpdated(also?: Also): string {
    if (!also) return '';
    const parts = KEYWORDS.filter((k) => also.updated[k]).map((k) => n(also.updated[k], `${k} line`, `${k} lines`));
    return parts.length ? ` Updated ${joinAnd(parts)}.` : '';
}

/** "Deleted Start, its 2 connections and 1 style line. Updated 1 class line." */
export function deletedText(name: string, connections: number, also?: Also): string {
    const own = connections === 0 ? [] : [connections === 1 ? 'its connection' : `its ${connections} connections`];
    const parts = [...own, ...alsoDeleted(also)];
    return `Deleted ${name}${parts.length ? `${parts.length === 1 ? ' and ' : ', '}${joinAnd(parts)}` : ''}.${alsoUpdated(also)}`;
}

/** A sentence for the other lines an edit changed, to follow its own message, or ''. */
export function alsoText(also?: Also): string {
    const deleted = alsoDeleted(also);
    return `${deleted.length ? ` Deleted ${joinAnd(deleted)}.` : ''}${alsoUpdated(also)}`;
}
