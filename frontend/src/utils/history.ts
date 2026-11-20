/**
 * Undo and redo over snapshots of the diagram text. Pure: every function returns a new history.
 *
 * Each recorded change is one step, except typing: a typed change that follows another typed change
 * within COALESCE_MS replaces it, so a burst of keystrokes is undone at once. At most LIMIT steps
 * are kept; the oldest are dropped first.
 */

export const LIMIT = 100;
export const COALESCE_MS = 1000;

export interface History {
    readonly past: readonly string[];
    readonly present: string;
    readonly future: readonly string[];
    /** When the last typed change was recorded; null when the last step was not typing. */
    readonly typedAt: number | null;
}

export function createHistory(text: string): History {
    return { past: [], present: text, future: [], typedAt: null };
}

/**
 * Record `next` as the current text. `typedAt`: for a keystroke in the code field, its time in
 * milliseconds (an event's timeStamp); null for any other change.
 */
export function record(history: History, next: string, typedAt: number | null = null): History {
    if (next === history.present) return history;
    if (typedAt !== null && history.typedAt !== null && typedAt - history.typedAt < COALESCE_MS) {
        return { ...history, present: next, future: [], typedAt };
    }
    return {
        past: [...history.past, history.present].slice(-LIMIT),
        present: next,
        future: [],
        typedAt,
    };
}

export const canUndo = (history: History): boolean => history.past.length > 0;
export const canRedo = (history: History): boolean => history.future.length > 0;

export function undo(history: History): History {
    if (!canUndo(history)) return history;
    return {
        past: history.past.slice(0, -1),
        present: history.past[history.past.length - 1],
        future: [history.present, ...history.future],
        typedAt: null,
    };
}

export function redo(history: History): History {
    if (!canRedo(history)) return history;
    return {
        past: [...history.past, history.present],
        present: history.future[0],
        future: history.future.slice(1),
        typedAt: null,
    };
}
