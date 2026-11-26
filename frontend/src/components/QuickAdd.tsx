import React, { useId, useMemo, useState } from 'react';
import { iconOf, searchSources, type IconSource, type Match } from '../utils/quickAdd';

const LIMIT = 8;

/** What to add: a match, or (match null) the typed text as a label, with the default icon or none. */
export type QuickChoice = { label: string; icon: string | null; match: Match | null };

interface Props {
    sources: IconSource[];
    /** Labels of the packs whose icon lists are still loading. */
    loading: string[];
    disabled: boolean;
    /** Where a new item goes, for the hint: a group's or subgraph's name, or null for the top level. */
    place: string | null;
    /** Adds the item; returns an error message to show, or null. */
    onAdd: (choice: QuickChoice) => string | null;
    inputRef: React.RefObject<HTMLInputElement | null>;
    /** What is added: "service" (architecture) or "node" (flowchart). */
    noun: string;
    placeholder: string;
    /** For the typed text as a new item: what it becomes (pack column), and its icon (null: none). */
    customNote: string;
    customIcon: string | null;
}

// The quick add field: a combobox over the built-in icons and every installed pack. Enter adds the
// highlighted match (or the typed text) and leaves the field empty, ready for the next one.
const QuickAdd: React.FC<Props> = ({ sources, loading, disabled, place, onAdd, inputRef, noun, placeholder, customNote, customIcon }) => {
    const id = useId();
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const [open, setOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const text = query.trim();
    const { matches, total } = useMemo(() => searchSources(sources, text, LIMIT), [sources, text]);
    // The typed text as its own last option, unless a match has exactly that name.
    const custom = text !== '' && !matches.some((m) => m.entry.name.toLowerCase() === text.toLowerCase());
    const options: QuickChoice[] = [
        ...matches.map((m) => ({ label: m.entry.name, icon: iconOf(m), match: m })),
        ...(custom ? [{ label: text, icon: customIcon, match: null }] : []),
    ];
    const at = Math.min(active, options.length - 1);
    const shown = open && text !== '';
    const optionId = (i: number) => `${id}-opt-${i}`;

    const add = (choice: QuickChoice | undefined) => {
        if (!choice) return;
        if (!choice.match && loading.length > 0 && matches.length === 0) {
            setError(`Still loading the icons of ${loading.join(', ')}. Try again in a moment.`);
            return;
        }
        const problem = onAdd(choice);
        setError(problem);
        if (problem) return;
        setQuery('');
        setActive(0);
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        const move = (to: number) => {
            e.preventDefault();
            setOpen(true);
            if (options.length) setActive((to + options.length) % options.length);
        };
        if (e.key === 'ArrowDown') move(at + 1);
        else if (e.key === 'ArrowUp') move(at - 1);
        else if (e.key === 'Enter') {
            e.preventDefault();
            add(options[at]);
        } else if (e.key === 'Escape' && query) {
            e.preventDefault();
            setQuery('');
            setError(null);
        }
    };

    const listId = `${id}-list`;
    const errorId = `${id}-error`;
    const where = place ? <>Enter adds to <strong>{place}</strong></> : <>Enter adds at the top level</>;
    return (
        <div className="quick-add">
            <div className="quick-add-field">
                <span className="quick-add-plus" aria-hidden="true">+</span>
                <input
                    ref={inputRef}
                    type="text"
                    role="combobox"
                    aria-label={`Add a ${noun}`}
                    aria-expanded={shown}
                    aria-controls={listId}
                    aria-autocomplete="list"
                    aria-activedescendant={shown && options.length ? optionId(at) : undefined}
                    aria-describedby={error ? errorId : undefined}
                    aria-invalid={error ? true : undefined}
                    aria-keyshortcuts="/"
                    placeholder={placeholder}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={disabled}
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); setError(null); }}
                    onKeyDown={onKeyDown}
                    onFocus={() => setOpen(true)}
                    onBlur={() => setOpen(false)}
                />
                <kbd className="quick-add-key" aria-hidden="true">/</kbd>
            </div>
            {shown && (
                <div className="quick-add-popup">
                    <ul id={listId} role="listbox" aria-label={`${noun[0].toUpperCase()}${noun.slice(1)}s to add`}>
                        {options.map((o, i) => (
                            <li
                                key={o.match ? `${o.icon}` : ':custom'}
                                id={optionId(i)}
                                role="option"
                                aria-selected={i === at}
                                className={i === at ? 'quick-add-option active' : 'quick-add-option'}
                                // Keep the focus in the field.
                                onMouseDown={(e) => e.preventDefault()}
                                // Only a pointer that really moves: the list appearing under a still
                                // pointer must not take the highlight from the keyboard.
                                onMouseMove={(e) => { if (i !== at && (e.movementX || e.movementY)) setActive(i); }}
                                onClick={() => add(o)}
                            >
                                {o.match ? (
                                    <>
                                        <span className="quick-add-name">{o.label}</span>
                                        <span className="quick-add-pack">{o.match.source}</span>
                                        <code>{o.icon}</code>
                                        {o.match.entry.group && <span className="quick-add-group">{o.match.entry.group}</span>}
                                    </>
                                ) : (
                                    <>
                                        <span className="quick-add-name">New {noun} “{o.label}”</span>
                                        <span className="quick-add-pack">{customNote}</span>
                                        {o.icon && <code>{o.icon}</code>}
                                    </>
                                )}
                            </li>
                        ))}
                    </ul>
                    <p className="quick-add-foot">
                        {where}
                        {total > matches.length && <> · first {matches.length} of {total} matches</>}
                        {loading.length > 0 && <> · loading {loading.join(', ')}…</>}
                    </p>
                </div>
            )}
            <p className="sr-only" role="status" aria-live="polite">
                {shown ? (total === 0 ? `No icon matches. Enter adds a new ${noun} with this label.` : `${total} ${total === 1 ? 'match' : 'matches'}.`) : ''}
            </p>
            {error && <p id={errorId} className="builder-error" role="alert">{error}</p>}
        </div>
    );
};

export default QuickAdd;
