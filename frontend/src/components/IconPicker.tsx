import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { loadPackFile, type PackEntry } from '../utils/iconPacks';
import { diagramKind, parseCatalog, previewCode, searchCatalog, type CatalogEntry } from '../utils/iconPicker';

// A list longer than this shows its first rows and asks for a narrower search.
const ROW_LIMIT = 500;
const PREVIEW_DEBOUNCE_MS = 150;

type Catalog = { status: 'loading' } | { status: 'error' } | { status: 'ready'; entries: CatalogEntry[] };

const LOADING: Catalog = { status: 'loading' };

interface Props {
    packs: PackEntry[];
    /** The diagram code, to tell whether it can take icons. */
    code: string;
    /** Adds the icon to the diagram; false when it could not be added. */
    onInsert: (prefix: string, entry: CatalogEntry) => boolean;
    /** Choosing mode (the builder's icon field): returns the entry and closes; nothing is inserted. */
    onChoose?: (prefix: string, entry: CatalogEntry) => void;
    onClose: () => void;
}

// Searchable list of the icons of an installed pack, by official product name. The list is text
// only: an icon is drawn only inside the rendered one-node diagram of the selected entry.
const IconPicker: React.FC<Props> = ({ packs, code, onInsert, onChoose, onClose }) => {
    const id = useId();
    const dialogRef = useRef<HTMLDialogElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const previewRef = useRef<HTMLDivElement>(null);
    const previewSeq = useRef(0);
    const [prefix, setPrefix] = useState(packs[0].prefix);
    const [catalogs, setCatalogs] = useState<Record<string, Catalog>>({});
    const [query, setQuery] = useState('');
    const [activeIcon, setActiveIcon] = useState<string | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [notice, setNotice] = useState('');

    const pack = packs.find((p) => p.prefix === prefix) ?? packs[0];
    const catalog = catalogs[pack.prefix] ?? LOADING;
    const choosing = onChoose !== undefined;
    const canInsert = choosing || diagramKind(code) !== 'other';

    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialog && !dialog.open) dialog.showModal();
        searchRef.current?.focus();
    }, []);

    // The pack file is shared with Mermaid's loader (one download per page).
    useEffect(() => {
        let active = true;
        const key = pack.prefix;
        loadPackFile(pack).then(
            (file) => active && setCatalogs((c) => ({ ...c, [key]: { status: 'ready', entries: parseCatalog(file, key) } })),
            () => active && setCatalogs((c) => ({ ...c, [key]: { status: 'error' } })),
        );
        return () => { active = false; };
    }, [pack]);

    const results = useMemo(
        () => (catalog.status === 'ready' ? searchCatalog(catalog.entries, query) : []),
        [catalog, query],
    );
    const shown = results.length > ROW_LIMIT ? results.slice(0, ROW_LIMIT) : results;
    const selected = shown.find((e) => e.icon === activeIcon) ?? shown[0] ?? null;
    const selectedIcon = selected?.icon;
    const optionId = (icon: string) => `${id}-opt-${icon}`;

    // Keep the selected row visible while moving with the arrow keys.
    useEffect(() => {
        if (selectedIcon) document.getElementById(`${id}-opt-${selectedIcon}`)?.scrollIntoView({ block: 'nearest' });
    }, [id, selectedIcon]);

    // Preview: the one-node diagram of the selected entry. Debounced; only the newest request may
    // write its result, so a slow render cannot overwrite a newer one.
    useEffect(() => {
        const target = previewRef.current;
        const seq = ++previewSeq.current;
        if (!target) return;
        if (!selected) {
            target.innerHTML = '';
            return;
        }
        const timer = setTimeout(async () => {
            try {
                // useId's punctuation differs between React versions; Mermaid uses the id in selectors.
                const renderId = `picker${id.replace(/[^A-Za-z0-9]/g, '')}-${seq}`;
                const result = await mermaid.render(renderId, previewCode(pack.prefix, selected));
                if (seq !== previewSeq.current) return;
                target.innerHTML = result.svg;
                setPreviewError(null);
            } catch (e) {
                if (seq !== previewSeq.current) return;
                target.innerHTML = '';
                setPreviewError(e instanceof Error ? e.message : String(e));
            }
        }, PREVIEW_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [id, pack.prefix, selected]);

    const select = (entry: CatalogEntry) => {
        setActiveIcon(entry.icon);
        setNotice('');
    };

    const insert = (entry: CatalogEntry | null = selected) => {
        if (!entry || !canInsert) return;
        if (onChoose) {
            onChoose(pack.prefix, entry);
            dialogRef.current?.close();
        } else if (onInsert(pack.prefix, entry)) {
            setNotice(`Added ${entry.name}`);
        }
    };

    const copyName = async () => {
        if (!selected) return;
        const name = `${pack.prefix}:${selected.icon}`;
        try {
            await navigator.clipboard.writeText(name);
            setNotice(`Copied ${name}`);
        } catch {
            setNotice('Copying is not available here. Select the name in the list instead.');
        }
    };

    // Arrow keys and Enter work from the search field (a combobox over the list).
    const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        const at = selected ? shown.indexOf(selected) : -1;
        const move = (to: number) => {
            e.preventDefault();
            const next = shown[Math.min(Math.max(to, 0), shown.length - 1)];
            if (next) select(next);
        };
        if (e.key === 'ArrowDown') move(at + 1);
        else if (e.key === 'ArrowUp') move(at - 1);
        else if (e.key === 'PageDown') move(at + 8);
        else if (e.key === 'PageUp') move(at - 8);
        else if (e.key === 'Home' && e.ctrlKey) move(0);
        else if (e.key === 'End' && e.ctrlKey) move(shown.length - 1);
        else if (e.key === 'Enter') {
            e.preventDefault();
            insert();
        }
    };

    const listId = `${id}-list`;
    const hintId = `${id}-hint`;
    return (
        <dialog
            ref={dialogRef}
            className="icon-picker"
            aria-labelledby={`${id}-title`}
            onClose={onClose}
            onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}
        >
            <div className="icon-picker-body">
                <h2 id={`${id}-title`}>{choosing ? 'Choose icon' : 'Insert icon'}</h2>
                <div className="icon-picker-controls">
                    {packs.length > 1 && (
                        <select
                            aria-label="Icon pack"
                            value={pack.prefix}
                            onChange={(e) => { setPrefix(e.target.value); setActiveIcon(null); setNotice(''); }}
                        >
                            {packs.map((p) => <option key={p.prefix} value={p.prefix}>{p.label}</option>)}
                        </select>
                    )}
                    <input
                        ref={searchRef}
                        type="text"
                        role="combobox"
                        aria-label="Search icons by name"
                        aria-expanded="true"
                        aria-controls={listId}
                        aria-activedescendant={selected ? optionId(selected.icon) : undefined}
                        aria-autocomplete="list"
                        placeholder="Search by product name"
                        autoComplete="off"
                        spellCheck={false}
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); setActiveIcon(null); setNotice(''); }}
                        onKeyDown={onSearchKeyDown}
                    />
                </div>
                <p className="icon-picker-count" role="status">
                    {catalog.status === 'loading' && 'Loading icons…'}
                    {catalog.status === 'error' && 'The icon list could not be loaded.'}
                    {catalog.status === 'ready' && (results.length === 1 ? '1 match' : `${results.length} matches`)}
                </p>
                <div className="icon-picker-columns">
                    <ul id={listId} className="icon-picker-list" role="listbox" aria-label={`Icons in ${pack.label}`}>
                        {shown.map((entry) => (
                            <li
                                key={entry.icon}
                                id={optionId(entry.icon)}
                                role="option"
                                aria-selected={entry === selected}
                                className={entry === selected ? 'icon-picker-row selected' : 'icon-picker-row'}
                                onClick={() => select(entry)}
                                onDoubleClick={() => { select(entry); insert(entry); }}
                            >
                                <span className="icon-picker-name">{entry.name}</span>
                                <code>{pack.prefix}:{entry.icon}</code>
                                {entry.group && <span className="icon-picker-group">{entry.group}</span>}
                            </li>
                        ))}
                        {results.length > shown.length && (
                            <li role="presentation" className="icon-picker-more">Showing the first {ROW_LIMIT} of {results.length}. Type to narrow the list.</li>
                        )}
                    </ul>
                    <div className="icon-picker-side">
                        <div className="icon-picker-preview">
                            <div ref={previewRef} role="img" aria-label={selected ? `Preview of ${selected.name}` : 'Preview'} />
                            {selected && previewError && <p className="icon-picker-error">{previewError}</p>}
                            {!selected && catalog.status === 'ready' && <p className="icon-picker-empty">No icon matches.</p>}
                        </div>
                    </div>
                </div>
                {!canInsert && (
                    <p id={hintId} className="icon-picker-hint">Icons can be added to architecture and flowchart diagrams. This diagram is of another kind: copy the name instead.</p>
                )}
                <p className="icon-picker-notice" role="status" aria-live="polite">{notice}</p>
                {pack.owner && pack.termsUrl && (
                    <p className="icon-picker-terms">
                        {pack.label} icons are subject to {pack.owner}'s{' '}
                        <a href={pack.termsUrl} target="_blank" rel="noopener noreferrer">terms of use</a>.
                    </p>
                )}
                <div className="icon-picker-actions">
                    <button type="button" className="icon-picker-primary" onClick={() => insert()} disabled={!selected || !canInsert} aria-describedby={canInsert ? undefined : hintId}>
                        {choosing ? 'Use this icon' : 'Insert into diagram'}
                    </button>
                    <button type="button" className="example-btn" onClick={() => void copyName()} disabled={!selected}>Copy name</button>
                    <button type="button" className="example-btn" onClick={() => dialogRef.current?.close()}>Close</button>
                </div>
            </div>
        </dialog>
    );
};

export default IconPicker;
