import React, { useEffect, useId, useRef } from 'react';
import { branding } from '../branding';
import type { PackEntry } from '../utils/iconPacks';

interface Props {
    packs: PackEntry[] | null;
    canAddPack: boolean;
    onAddPack: () => void;
    onClose: () => void;
}

// What the product is and what it offers: the text that used to fill the top of the sidebar.
const AboutDialog: React.FC<Props> = ({ packs, canAddPack, onAddPack, onClose }) => {
    const id = useId();
    const dialogRef = useRef<HTMLDialogElement>(null);
    const installedPacks = packs ?? [];
    const commercial = Boolean(branding.contactEmail);
    const hasGcp = installedPacks.some((p) => p.prefix === 'gcp');
    const otherPacks = installedPacks.filter((p) => p.prefix !== 'gcp');

    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialog && !dialog.open) dialog.showModal();
    }, []);

    return (
        <dialog
            ref={dialogRef}
            className="icon-picker about-dialog"
            aria-labelledby={`${id}-title`}
            onClose={onClose}
            onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}
        >
            <div className="icon-picker-body about-body">
                <h2 id={`${id}-title`}>About {branding.productName}</h2>
                <div className="about-scroll">
                    <p className="about-tagline">{commercial
                        ? 'Enterprise Mermaid rendering with provenance tracking. Try the API or use the editor.'
                        : 'Mermaid diagrams as self-contained SVG and PNG files, with the source embedded. Use the editor or the API.'}</p>
                    <div className="info-section">
                        <div className="info-header">{commercial ? '🏢 Enterprise Features' : 'Features'}</div>
                        <ul className="info-list">
                            <li><strong>API Access:</strong> POST to /api/generate for programmatic rendering</li>
                            <li><strong>Metadata Injection:</strong> Source code embedded in every export</li>
                            <li><strong>Audit Trail:</strong> Recover original Mermaid from any exported file</li>
                            {hasGcp && (
                                <li><strong>Google Cloud diagrams:</strong> Official Google Cloud product icons via the <code>gcp:</code> icon pack (see the "Google Cloud Architecture" example)</li>
                            )}
                            {otherPacks.length > 0 && (
                                <li><strong>Icon packs:</strong> {otherPacks.map((p, i) => (
                                    <React.Fragment key={p.prefix}>{i > 0 && ', '}{p.label} (<code>{p.prefix}:</code>)</React.Fragment>
                                ))}</li>
                            )}
                            {packs !== null && installedPacks.length === 0 && (
                                <li><strong>Cloud provider icons:</strong> {canAddPack
                                    ? <button type="button" className="link-btn" onClick={onAddPack}>add an icon pack</button>
                                    : 'add an icon pack'} to draw with a vendor's official product icons</li>
                            )}
                            <li><strong>Rate Limited:</strong> 20 req/min{commercial && ' - contact us for enterprise quotas'}</li>
                        </ul>
                        {branding.contactEmail && (
                            <div className="info-warning">
                                <strong>💼 Need higher limits or self-hosting?</strong> Contact us at <a href={`mailto:${branding.contactEmail}`}>{branding.contactEmail}</a> for enterprise licensing.
                            </div>
                        )}
                    </div>
                    <p><strong>API Documentation:</strong> <code>POST /api/generate</code> with <code>{'{code: "graph TD; A-->B;", output: "png"}'}</code>. Response: image with embedded metadata. Rate limit: 20/min.</p>
                    {branding.contactEmail && (
                        <p>Enterprise SLA available. <a href={`mailto:${branding.contactEmail}`}>Contact sales</a>.</p>
                    )}
                </div>
                <div className="icon-picker-actions">
                    <button type="button" className="example-btn" onClick={() => dialogRef.current?.close()}>Close</button>
                </div>
            </div>
        </dialog>
    );
};

export default AboutDialog;
