/**
 * Starter diagrams for the builder. A pack's starter is offered only when that pack is installed and
 * every icon it names is in the pack's catalog; labels are official product names. Pure data and
 * functions, so they also run under `node --test`.
 */

export interface Template {
    id: string;
    kind: 'architecture' | 'flowchart';
    title: string;
    description: string;
    /** The pack whose icons it uses; null: only Mermaid's built-in icons. */
    pack: string | null;
    code: string;
}

export const EMPTY_TEMPLATE_ID = 'empty';
export const EMPTY_FLOWCHART_ID = 'flowchart-empty';

export const TEMPLATES: readonly Template[] = [
    {
        id: EMPTY_TEMPLATE_ID,
        kind: 'architecture',
        title: 'Empty architecture diagram',
        description: 'Start from nothing and add services one by one.',
        pack: null,
        code: 'architecture-beta\n',
    },
    {
        id: 'web',
        kind: 'architecture',
        title: 'Web application (three tiers)',
        description: 'Users, a web server, an application server, a database and file storage.',
        pack: null,
        code: `architecture-beta
  group web(cloud)[Web application]
  service users(internet)[Users]
  service frontend(server)[Web server] in web
  service backend(server)[Application server] in web
  service db(database)[Database] in web
  service files(disk)[File storage] in web
  users:R --> L:frontend
  frontend:R --> L:backend
  backend:R --> L:db
  backend:B --> T:files
`,
    },
    {
        id: 'gcp',
        kind: 'architecture',
        title: 'Google Cloud web service',
        description: 'Cloud Load Balancing in front of Cloud Run, with Cloud SQL, Cloud Storage and Pub/Sub.',
        pack: 'gcp',
        code: `architecture-beta
  group project(cloud)[Google Cloud project]
  service users(internet)[Users]
  service lb(gcp:cloud-load-balancing)[Cloud Load Balancing] in project
  service run(gcp:cloud-run)[Cloud Run] in project
  service sql(gcp:cloud-sql)[Cloud SQL] in project
  service storage(gcp:cloud-storage)[Cloud Storage] in project
  service events(gcp:pubsub)[Pub/Sub] in project
  users:R --> L:lb
  lb:R --> L:run
  run:R --> L:sql
  run:B --> T:storage
  run:T --> B:events
`,
    },
    {
        id: 'aws',
        kind: 'architecture',
        title: 'AWS serverless web application',
        description: 'Amazon CloudFront and Amazon S3 for the site; Amazon API Gateway, AWS Lambda and Amazon DynamoDB for the API.',
        pack: 'aws',
        code: `architecture-beta
  group cloud(aws:aws-cloud)[AWS Cloud]
  service users(internet)[Users]
  service cdn(aws:amazon-cloudfront)[Amazon CloudFront] in cloud
  service site(aws:amazon-simple-storage-service)[Amazon S3] in cloud
  service api(aws:amazon-api-gateway)[Amazon API Gateway] in cloud
  service fn(aws:aws-lambda)[AWS Lambda] in cloud
  service db(aws:amazon-dynamodb)[Amazon DynamoDB] in cloud
  service auth(aws:amazon-cognito)[Amazon Cognito] in cloud
  users:R --> L:cdn
  cdn:B --> T:site
  cdn:R --> L:api
  api:R --> L:fn
  fn:R --> L:db
  api:B --> T:auth
`,
    },
    {
        id: 'azure',
        kind: 'architecture',
        title: 'Microsoft Azure web application',
        description: 'Azure Front Door in front of Azure App Service, with Azure SQL Database, Azure Storage and Azure Key Vault.',
        pack: 'azure',
        code: `architecture-beta
  group rg(azure:resource-groups)[Resource group]
  service users(internet)[Users]
  service door(azure:front-door-and-cdn-profiles)[Azure Front Door] in rg
  service app(azure:app-services)[Azure App Service] in rg
  service sql(azure:sql-database)[Azure SQL Database] in rg
  service storage(azure:storage-accounts)[Azure Storage] in rg
  service vault(azure:key-vaults)[Azure Key Vault] in rg
  users:R --> L:door
  door:R --> L:app
  app:R --> L:sql
  app:B --> T:storage
  app:T --> B:vault
`,
    },
];

/** Flowchart starters: shapes and arrows only, no icons. */
export const FLOWCHART_TEMPLATES: readonly Template[] = [
    {
        id: EMPTY_FLOWCHART_ID,
        kind: 'flowchart',
        title: 'Empty flowchart',
        description: 'Start from nothing and add steps one by one.',
        pack: null,
        code: 'flowchart TD\n',
    },
    {
        id: 'flowchart-decision',
        kind: 'flowchart',
        title: 'Decision flow',
        description: 'A question with Yes and No answers, and a way back to try again.',
        pack: null,
        code: `flowchart TD
  start(["Start"])
  check{"Is it ready?"}
  done(["Done"])
  fix["Fix it"]
  start --> check
  check -->|"Yes"| done
  check -->|"No"| fix
  fix --> check
`,
    },
    {
        id: 'flowchart-stages',
        kind: 'flowchart',
        title: 'Process with stages',
        description: 'Steps grouped into Plan, Build and Release stages.',
        pack: null,
        code: `flowchart LR
  subgraph plan ["Plan"]
    idea["Idea"] --> spec["Write the plan"]
  end
  subgraph build ["Build"]
    work["Do the work"] --> review{"Review"}
  end
  subgraph release ["Release"]
    ship(["Release"])
  end
  spec --> work
  review -->|"Changes"| work
  review -->|"Approved"| ship
`,
    },
];

/** The pack icons a template uses, without their prefix. */
export function packIcons(template: Template): string[] {
    if (!template.pack) return [];
    const re = new RegExp(String.raw`\(${template.pack}:([\w-]+)\)`, 'g');
    return [...template.code.matchAll(re)].map((m) => m[1]);
}

/** The templates to offer: built-in ones, and each pack's when every icon it names is in `catalogs[pack]`. */
export function availableTemplates(catalogs: Readonly<Record<string, ReadonlySet<string> | undefined>>): Template[] {
    return TEMPLATES.filter((t) => {
        if (!t.pack) return true;
        const icons = catalogs[t.pack];
        return icons !== undefined && packIcons(t).every((icon) => icons.has(icon));
    });
}
