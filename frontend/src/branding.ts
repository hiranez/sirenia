export interface Branding {
    /** Product name shown in the page title, header, footer and messages. */
    productName: string;
    /** Public contact address for limits / licensing; the sales passages render only when set. */
    contactEmail: string | null;
    /** Company behind the product, named in the Google non-affiliation sentence; null for a community build. */
    vendorName: string | null;
    /** The project this edition is built from, named with a link in the footer; null for the project itself. */
    basedOn: { name: string; url: string } | null;
}

// Injected at build time by vite.config.ts (from the file named by BRANDING_FILE).
declare const __BRANDING__: Branding;

export const branding: Branding = __BRANDING__;
