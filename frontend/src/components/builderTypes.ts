// What the Build tab's shell (DiagramBuilder) needs from a kind of diagram. One adapter per kind
// (architecture, flowchart) turns its model into outline rows, edits and preview marks; the shell
// owns the state (selection, connect mode, forms, status line) and the keyboard.
import type React from 'react';
import type { CatalogEntry } from '../utils/iconPicker';

/** The item selected in the builder. An architecture connection has no id: its line, and the line's text to find it again. */
export type BuilderSelection =
    | { kind: 'node'; id: string }
    | { kind: 'edge'; line: number; text: string }
    | { kind: 'link'; key: string };

/** An edit's result, as both models return it. */
export type Result = { ok: true; code: string; id?: string; key?: string; line?: number } | { ok: false; error: { code: string; message: string } };

/** What a form or an action selects afterwards; `{ kind: 'edge', line }` is completed by the shell. */
export type NextSelection = { kind: 'node'; id: string } | { kind: 'edge'; line: number } | { kind: 'link'; key: string } | null;

/** The result of a form's action and what to select after it; returns the error to show, if any. */
export type FormDone = (result: Result, select: NextSelection, message: string) => { code: string; message: string } | null;

export interface Row {
    key: string;
    selection: BuilderSelection;
    depth: number;
    /** The kind chip (`service`, `subgraph`, …), also its class `kind-…`. */
    tag?: string;
    label: string;
    codes: string[];
    note?: string;
    /** The node a click or Enter on the row connects to in connect mode. */
    target: string | null;
    /** The form field that Enter and a double click put the cursor in. */
    field: string;
}

/** The selected item, as the shell shows it. */
export interface Selected {
    key: string;
    name: string;
    isNode: boolean;
    /** Can start a connection ("Connect to…"). */
    connectable: boolean;
    /** Changes with the item's text, so that its form starts from the text again. */
    formKey: string;
}

/** An action's outcome: the edit, the status message, what to select and the field to focus. */
export interface Outcome { result: Result; message: string; select?: NextSelection; field?: string }

export interface FormProps {
    code: string;
    /** `add`: a new item of that kind with the values to start from; `edit`: the selection. */
    target: unknown;
    onChooseIcon?: (onChoose: (prefix: string, entry: CatalogEntry) => void, opener: HTMLElement) => void;
    onAddPack?: (opener: HTMLElement) => void;
    onDone: FormDone;
    onCancel: () => void;
    /** Leave the form (Esc in a field): focus goes back to the outline. */
    onLeave: () => void;
}

export interface Adapter {
    kind: 'architecture' | 'flowchart';
    nodeRows: Row[];
    edgeRows: Row[];
    resolve: (selection: BuilderSelection | null) => Selected | null;
    /** Whether `id` can be the end of a connection made by clicking. */
    isEndpoint: (id: string | null) => boolean;
    name: (id: string) => string;
    /** The group or subgraph quick add puts a node in, by name; null is the top level. */
    placeName: (selection: BuilderSelection | null) => string | null;
    tools: { label: string; what: string }[];
    /** A select in the toolbar (the flowchart's direction). */
    toolSelect?: { label: string; value: string; options: { value: string; label: string }[]; set: (value: string) => Outcome };
    addTarget: (what: string, selection: BuilderSelection | null) => unknown;
    editTarget: (selection: BuilderSelection) => unknown;
    renderForm: (key: string, props: FormProps) => React.ReactNode;
    quickAdd: (choice: { label: string; icon: string | null }, selection: BuilderSelection | null) => Outcome;
    /** Why a connection cannot start at the selection, or null. */
    connectProblem: (selection: BuilderSelection | null) => string | null;
    /** Null when either node is gone (nothing happens). */
    connect: (from: string, to: string, svg: SVGSVGElement | null) => Outcome | null;
    /** Delete the selection; a group with items asks first (`ask`, with the key to confirm). */
    remove: (selection: BuilderSelection, confirmed: string | null) => Outcome | { ask: string; key: string } | null;
    hit: (svg: SVGSVGElement, target: EventTarget | null, x: number, y: number) => BuilderSelection | null;
    endpointAt: (svg: SVGSVGElement, target: EventTarget | null, x: number, y: number) => string | null;
    drawMarks: (svg: SVGSVGElement, selection: BuilderSelection | null, connecting: string | null, target: string | null) => void;
    /** The quiet line about lines kept but not managed, or null. */
    unmanaged: string | null;
    texts: {
        noun: string;
        quickPlaceholder: string;
        customNote: string;
        customIcon: string | null;
        noNodes: string;
        noEdges: string;
        selectHint: string;
    };
    /** Whether replacing the diagram with a starter loses nothing (then it does not ask first). */
    keepsNothing: boolean;
}
