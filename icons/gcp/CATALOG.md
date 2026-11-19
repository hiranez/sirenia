# Google Cloud icon catalog for Mermaid (`gcp:` pack)

> **Generated** by `scripts/build-gcp-icon-pack.mjs` from `icons/gcp/mapping.json` (v2026.05) — do not edit by hand.
> Source of the equivalence: Google's *Google Cloud product icons* guide (May 2026) and the official icon ZIPs at <https://cloud.google.com/icons>.

**45 icons** (19 unique core-product icons + 26 category icons), **460 aliases**, **238 products** (206 from Google's guide, 1 shipped only in the ZIP, 31 extensions).

Usage: `service x(gcp:<name>)[Label]` in `architecture-beta`, or `n@{ icon: "gcp:<name>", label: "…" }` in flowcharts. Any name in the **Mermaid icon** or **Aliases** columns works.

**Legend** — *kind*: `core` = product-specific 4-color icon; `category` = shared 2-color category icon (Google's 2025 system deliberately reuses one icon per category, so always label the node). *Source*: `guide` = listed in Google's guide; `zip` = icon shipped but not listed; `extension` = not in Google's guide, mapped by this project to the closest official category — review on each upstream update.

## Base icons

| Icon id | Kind | Official name | Aliases |
|---|---|---|---|
| `gcp:ai-hypercomputer` | core | AI Hypercomputer | — |
| `gcp:alloydb` | core | AlloyDB | — |
| `gcp:anthos` | core | Anthos | — |
| `gcp:apigee` | core | Apigee | — |
| `gcp:bigquery` | core | BigQuery | — |
| `gcp:cloud-run` | core | Cloud Run | — |
| `gcp:cloud-sql` | core | Cloud SQL | — |
| `gcp:spanner` | core | Spanner | `cloud-spanner` |
| `gcp:cloud-storage` | core | Cloud Storage | — |
| `gcp:compute-engine` | core | Compute Engine | — |
| `gcp:distributed-cloud` | core | Google Distributed Cloud | — |
| `gcp:gke` | core | Google Kubernetes Engine | — |
| `gcp:hyperdisk` | core | Hyperdisk | — |
| `gcp:looker` | core | Looker | — |
| `gcp:mandiant` | core | Mandiant | — |
| `gcp:security-command-center` | core | Security Command Center | — |
| `gcp:security-operations` | core | Google Security Operations | — |
| `gcp:threat-intelligence` | core | Google Threat Intelligence | — |
| `gcp:vertex-ai` | core | Vertex AI | — |
| `gcp:ai-applications-agents` | category | AI Applications & Agents | `agents`, `ai-agents`, `ai-applications` |
| `gcp:ai-machine-learning` | category | AI and Machine Learning | `ai-ml`, `machine-learning`, `ml` |
| `gcp:business-intelligence` | category | Business Intelligence | `bi` |
| `gcp:collaboration` | category | Collaboration | — |
| `gcp:compute` | category | Compute | — |
| `gcp:containers` | category | Containers | — |
| `gcp:data-analytics` | category | Data Analytics | `analytics` |
| `gcp:databases` | category | Databases | `database` |
| `gcp:developer-tools` | category | Developer Tools | `dev-tools` |
| `gcp:devops` | category | DevOps | `ci-cd` |
| `gcp:hybrid-multicloud` | category | Hybrid and Multicloud | `hybrid`, `multicloud` |
| `gcp:integration-services` | category | Integration Services | `integration` |
| `gcp:management-tools` | category | Management Tools | `management` |
| `gcp:maps-geospatial` | category | Maps & Geospatial | `geospatial` |
| `gcp:marketplace` | category | Google Cloud Marketplace | — |
| `gcp:media-services` | category | Media Services | `media` |
| `gcp:migration` | category | Migration | — |
| `gcp:mixed-reality` | category | Mixed Reality | `xr` |
| `gcp:networking` | category | Networking | `network` |
| `gcp:observability` | category | Observability | — |
| `gcp:operations` | category | Operations | `ops` |
| `gcp:security-identity` | category | Security and Identity | `security`, `identity` |
| `gcp:serverless-computing` | category | Serverless Computing | `serverless` |
| `gcp:storage` | category | Storage | — |
| `gcp:web-mobile` | category | Web and Mobile | `web`, `mobile` |
| `gcp:web3` | category | Web3 | `blockchain` |

## Products by category

### AI Applications & Agents

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| AI Testing agent | `gcp:ai-testing-agent` | category → `ai-applications-agents` | — | guide | — |
| Automotive AI agent | `gcp:automotive-ai-agent` | category → `ai-applications-agents` | — | guide | — |
| Code Documentation agent | `gcp:code-documentation-agent` | category → `ai-applications-agents` | — | guide | — |
| Deep Research agent | `gcp:deep-research-agent` | category → `ai-applications-agents` | — | guide | — |
| Food ordering AI agent | `gcp:food-ordering-ai-agent` | category → `ai-applications-agents` | — | guide | — |
| Idea Generation agent | `gcp:idea-generation-agent` | category → `ai-applications-agents` | — | guide | — |
| Customer Engagement Suite | `gcp:customer-engagement-suite` | category → `ai-applications-agents` | `ces`, `contact-center-ai` | guide | legacy: `contact_center_ai` The guide lists it under both 'AI Applications & Agents' and 'AI and Machine Learning'; the more specific category is used. |
| Conversational Agents | `gcp:conversational-agents` | category → `ai-applications-agents` | `dialogflow-cx` | guide | legacy: `dialogflow_cx` Formerly Dialogflow CX. |
| Agent Assist | `gcp:agent-assist` | category → `ai-applications-agents` | — | guide | legacy: `agent_assist` Also listed under 'AI and Machine Learning' in the guide. |
| Conversational Insights | `gcp:conversational-insights` | category → `ai-applications-agents` | `dialogflow-insights` | guide | legacy: `dialogflow_insights` |
| Contact Center as a Service | `gcp:contact-center-as-a-service` | category → `ai-applications-agents` | `ccaas` | guide | — |
| Google Agentspace | `gcp:agentspace` | category → `ai-applications-agents` | — | extension | — |
| Vertex AI Agent Builder | `gcp:vertex-ai-agent-builder` | category → `ai-applications-agents` | `agent-builder`, `agent-engine`, `vertex-ai-agent-engine` | extension | — |

### AI and Machine Learning

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| Advanced Agent Modeling | `gcp:advanced-agent-modeling` | category → `ai-machine-learning` | — | guide | legacy: `advanced_agent_modeling` |
| AI Hub | `gcp:ai-hub` | category → `ai-machine-learning` | — | guide | legacy: `ai_hub` |
| AI Hypercomputer ★ | `gcp:ai-hypercomputer` | core | — | guide | — |
| AI Platform | `gcp:ai-platform` | category → `ai-machine-learning` | — | guide | legacy: `ai_platform` |
| AI Platform Unified | `gcp:ai-platform-unified` | category → `ai-machine-learning` | — | guide | legacy: `ai_platform_unified` |
| AutoML | `gcp:automl` | category → `ai-machine-learning` | — | guide | legacy: `automl` |
| AutoML Natural Language | `gcp:automl-natural-language` | category → `ai-machine-learning` | — | guide | legacy: `automl_natural_language` |
| AutoML Tables | `gcp:automl-tables` | category → `ai-machine-learning` | — | guide | legacy: `automl_tables` |
| AutoML Translation | `gcp:automl-translation` | category → `ai-machine-learning` | — | guide | legacy: `automl_translation` |
| AutoML Video Intelligence | `gcp:automl-video-intelligence` | category → `ai-machine-learning` | — | guide | legacy: `automl_video_intelligence` |
| AutoML Vision | `gcp:automl-vision` | category → `ai-machine-learning` | — | guide | legacy: `automl_vision` |
| Cloud GPU | `gcp:cloud-gpu` | category → `ai-machine-learning` | `gpu`, `cloud-gpus` | guide | legacy: `cloud_gpu` |
| Cloud Healthcare API | `gcp:cloud-healthcare-api` | category → `ai-machine-learning` | `healthcare-api` | guide | legacy: `cloud_healthcare_api` |
| Cloud Natural Language API | `gcp:cloud-natural-language-api` | category → `ai-machine-learning` | `natural-language-api`, `natural-language` | guide | legacy: `cloud_natural_language_api` |
| Cloud Optimization AI | `gcp:cloud-optimization-ai` | category → `ai-machine-learning` | — | guide | legacy: `cloud_optimization_ai` |
| Cloud Optimization AI Fleet Routing API | `gcp:cloud-optimization-ai-fleet-routing-api` | category → `ai-machine-learning` | `fleet-routing-api` | guide | legacy: `cloud_optimization_ai_-_fleet_routing_api` |
| Cloud TPU | `gcp:cloud-tpu` | category → `ai-machine-learning` | `tpu` | guide | legacy: `cloud_tpu` |
| Cloud Translation API | `gcp:cloud-translation-api` | category → `ai-machine-learning` | `translation-api`, `translation` | guide | legacy: `cloud_translation_api` |
| Cloud Vision API | `gcp:cloud-vision-api` | category → `ai-machine-learning` | `vision-api`, `vision-ai` | guide | legacy: `cloud_vision_api` |
| Data Labeling | `gcp:data-labeling` | category → `ai-machine-learning` | — | guide | legacy: `data_labeling` |
| Dialogflow ES | `gcp:dialogflow-es` | category → `ai-machine-learning` | `dialogflow` | guide | legacy: `dialogflow` |
| Document AI | `gcp:document-ai` | category → `ai-machine-learning` | `docai` | guide | legacy: `document_ai` |
| Genomics | `gcp:genomics` | category → `ai-machine-learning` | — | guide | legacy: `genomics` |
| Healthcare NLP API | `gcp:healthcare-nlp-api` | category → `ai-machine-learning` | — | guide | legacy: `healthcare_nlp_api` |
| Media Translation API | `gcp:media-translation-api` | category → `ai-machine-learning` | — | guide | legacy: `media_translation_api` |
| Recommendations AI | `gcp:recommendations-ai` | category → `ai-machine-learning` | — | guide | legacy: `recommendations_ai` |
| Speech to Text | `gcp:speech-to-text` | category → `ai-machine-learning` | `stt` | guide | legacy: `speech-to-text` |
| TensorFlow Enterprise | `gcp:tensorflow-enterprise` | category → `ai-machine-learning` | — | guide | legacy: `tensorflow_enterprise` |
| Text to Speech | `gcp:text-to-speech` | category → `ai-machine-learning` | `tts` | guide | legacy: `text-to-speech` |
| Visual Inspection AI | `gcp:visual-inspection-ai` | category → `ai-machine-learning` | — | guide | legacy: `visual_inspection` |
| Vertex AI ★ | `gcp:vertex-ai` | core | `vertex`, `vertexai`, `model-garden`, `vertex-ai-pipelines`, `vertex-ai-workbench` | zip | legacy: `vertexai` Unique icon shipped in core-products-icons.zip; not listed in the guide. |
| Gemini (Code Assist, Enterprise, etc.) ★ | `gcp:gemini` | category → `ai-machine-learning` | `gemini-code-assist`, `gemini-enterprise`, `gemini-cloud-assist` | guide | Marked core in the guide, but NO Gemini icon is distributed in the icon ZIPs and the Gemini mark has its own brand guidelines — never improvise the Gemini logo. Category icon used as the sanctioned fallback. |

### Business Intelligence

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| Looker ★ | `gcp:looker` | core | — | guide | legacy: `looker` |
| Looker Studio ★ | `gcp:looker-studio` | core → `looker` | `data-studio` | guide | legacy: `data_studio` Marked core in the guide; no dedicated file shipped, defaults to the Looker core icon. |
| Looker Studio Pro ★ | `gcp:looker-studio-pro` | core → `looker` | — | guide | Marked core in the guide; no dedicated file shipped, defaults to the Looker core icon. |

### Collaboration

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| Google Workspace | `gcp:google-workspace` | category → `collaboration` | `workspace` | guide | Google Workspace has its own brand program; the Collaboration category icon is the only option inside the Google Cloud icon set. |

### Compute

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| Batch | `gcp:batch` | category → `compute` | `cloud-batch` | guide | legacy: `batch` |
| Compute Engine ★ | `gcp:compute-engine` | core | `gce`, `vm`, `virtual-machine` | guide | legacy: `compute_engine` |
| Container-Optimized OS | `gcp:container-optimized-os` | category → `compute` | `cos` | guide | legacy: `container_optimized_os` |
| GCE Systems Management | `gcp:gce-systems-management` | category → `compute` | — | guide | legacy: `gce_systems_management` |
| Migrate to Virtual Machines | `gcp:migrate-to-virtual-machines` | category → `compute` | `migrate-to-vms`, `m2vm` | guide | — |
| OS Config Management | `gcp:os-config-management` | category → `compute` | `vm-manager` | guide | legacy: `os_configuration_management` |
| OS Inventory Management | `gcp:os-inventory-management` | category → `compute` | — | guide | legacy: `os_inventory_management` |
| OS Patch Management | `gcp:os-patch-management` | category → `compute` | — | guide | legacy: `os_patch_management` |
| VMware Engine | `gcp:vmware-engine` | category → `compute` | `gcve`, `google-cloud-vmware-engine` | guide | legacy: `vmware_engine` |
| Managed Instance Group | `gcp:managed-instance-group` | category → `compute` | `mig` | extension | — |
| Sole-tenant Nodes | `gcp:sole-tenant-nodes` | category → `compute` | — | extension | — |
| Confidential Computing | `gcp:confidential-computing` | category → `compute` | `confidential-vm` | extension | — |

### Containers

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| Backup for GKE | `gcp:backup-for-gke` | category → `containers` | — | guide | — |
| Google Kubernetes Engine ★ | `gcp:gke` | core | `google-kubernetes-engine`, `kubernetes-engine`, `gke-autopilot`, `gke-standard` | guide | legacy: `google_kubernetes_engine` |
| Knative serving | `gcp:knative-serving` | category → `containers` | `knative` | guide | legacy: `kuberun` |
| Migrate to Containers | `gcp:migrate-to-containers` | category → `containers` | `m2c` | guide | legacy: `migrate_for_anthos` |
| GKE Enterprise | `gcp:gke-enterprise` | core → `anthos` | — | extension | GKE Enterprise is the Anthos successor; the guide still lists Anthos as the core product, so the Anthos icon is used. |

### Data Analytics

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| Analytics Hub | `gcp:analytics-hub` | category → `data-analytics` | — | guide | legacy: `analytics_hub` |
| BigLake | `gcp:biglake` | category → `data-analytics` | — | guide | — |
| BigQuery ★ | `gcp:bigquery` | core | `bq` | guide | legacy: `bigquery` |
| BigQuery Functions ★ | `gcp:bigquery-functions` | core → `bigquery` | — | guide | — |
| BigQuery Omni ★ | `gcp:bigquery-omni` | core → `bigquery` | — | guide | — |
| Cloud Composer | `gcp:cloud-composer` | category → `data-analytics` | `composer` | guide | legacy: `cloud_composer` |
| Cloud Data Fusion | `gcp:cloud-data-fusion` | category → `data-analytics` | `data-fusion` | guide | legacy: `cloud_data_fusion` |
| Data Catalog | `gcp:data-catalog` | category → `data-analytics` | — | guide | legacy: `data_catalog` |
| Data Layers | `gcp:data-layers` | category → `data-analytics` | — | guide | legacy: `data_layers` |
| Data Loss Prevention API | `gcp:data-loss-prevention-api` | category → `data-analytics` | `dlp`, `sensitive-data-protection`, `sdp` | guide | legacy: `data_loss_prevention_api` Now branded Sensitive Data Protection; the guide places it under Data Analytics (not Security). |
| Dataflow | `gcp:dataflow` | category → `data-analytics` | — | guide | legacy: `dataflow` |
| Dataplex | `gcp:dataplex` | category → `data-analytics` | `dataplex-universal-catalog` | guide | legacy: `dataplex` |
| Datapol | `gcp:datapol` | category → `data-analytics` | — | guide | legacy: `datapol` |
| Dataprep | `gcp:dataprep` | category → `data-analytics` | — | guide | legacy: `dataprep` |
| Dataproc | `gcp:dataproc` | category → `data-analytics` | `dataproc-serverless` | guide | legacy: `dataproc` |
| Dataproc Metastore | `gcp:dataproc-metastore` | category → `data-analytics` | — | guide | legacy: `dataproc_metastore` |
| Datashare | `gcp:datashare` | category → `data-analytics` | — | guide | legacy: `datashare` |
| Datastream | `gcp:datastream` | category → `data-analytics` | — | guide | legacy: `datastream` |
| Pub/Sub | `gcp:pubsub` | category → `data-analytics` | `pub-sub`, `cloud-pubsub`, `pubsub-lite` | guide | legacy: `pubsub` |
| Dataform | `gcp:dataform` | category → `data-analytics` | — | extension | — |
| BigQuery ML | `gcp:bigquery-ml` | core → `bigquery` | `bqml` | extension | — |
| BigQuery Data Transfer Service | `gcp:bigquery-data-transfer-service` | core → `bigquery` | — | extension | — |

### Databases

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| AlloyDB ★ | `gcp:alloydb` | core | `alloydb-for-postgresql` | guide | — |
| AlloyDB Omni ★ | `gcp:alloydb-omni` | core → `alloydb` | — | guide | — |
| Bare Metal Solution | `gcp:bare-metal-solution` | category → `databases` | `bms` | guide | legacy: `bare_metal_solutions` |
| Bigtable | `gcp:bigtable` | category → `databases` | `cloud-bigtable` | guide | legacy: `bigtable` |
| Cloud SQL ★ | `gcp:cloud-sql` | core | `cloudsql` | guide | legacy: `cloud_sql` |
| Database Center | `gcp:database-center` | category → `databases` | — | guide | — |
| Database Migration Service | `gcp:database-migration-service` | category → `databases` | `dms` | guide | legacy: `database_migration_service` |
| Datastore | `gcp:datastore` | category → `databases` | `cloud-datastore` | guide | legacy: `datastore` |
| Firestore | `gcp:firestore` | category → `databases` | `cloud-firestore` | guide | legacy: `firestore` |
| Memorystore | `gcp:memorystore` | category → `databases` | `memorystore-for-redis`, `memorystore-for-valkey`, `memorystore-for-memcached` | guide | legacy: `memorystore` |
| Spanner ★ | `gcp:spanner` | core | — | guide | legacy: `cloud_spanner` |
| SQL | `gcp:sql` | category → `databases` | — | guide | Listed verbatim as 'SQL' in the guide. Most diagrams mean Cloud SQL — prefer gcp:cloud-sql. |

### Developer Tools

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| Cloud Code | `gcp:cloud-code` | category → `developer-tools` | — | guide | legacy: `cloud_code` |
| Cloud Deployment Manager | `gcp:cloud-deployment-manager` | category → `developer-tools` | `deployment-manager` | guide | legacy: `cloud_deployment_manager` |
| Cloud Scheduler | `gcp:cloud-scheduler` | category → `developer-tools` | `scheduler` | guide | legacy: `cloud_scheduler` |
| Cloud Shell | `gcp:cloud-shell` | category → `developer-tools` | — | guide | legacy: `cloud_shell` |
| Cloud Tasks | `gcp:cloud-tasks` | category → `developer-tools` | `tasks` | guide | legacy: `cloud_tasks` |
| Cloud Workstations | `gcp:cloud-workstations` | category → `developer-tools` | `workstations` | guide | — |
| Runtime Config | `gcp:runtime-config` | category → `developer-tools` | — | guide | legacy: `runtime_config` |
| Service Catalog | `gcp:service-catalog` | category → `developer-tools` | — | guide | legacy: `catalog` |
| Tools for PowerShell | `gcp:tools-for-powershell` | category → `developer-tools` | — | guide | legacy: `tools_for_powershell` |
| Infrastructure Manager | `gcp:infrastructure-manager` | category → `developer-tools` | `infra-manager` | extension | Terraform-based successor of Deployment Manager. |
| Google Cloud SDK / gcloud CLI | `gcp:cloud-sdk` | category → `developer-tools` | `gcloud`, `gcloud-cli` | extension | — |

### DevOps

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| Artifact Registry | `gcp:artifact-registry` | category → `devops` | — | guide | legacy: `artifact_registry` |
| Cloud Build | `gcp:cloud-build` | category → `devops` | — | guide | legacy: `cloud_build` |
| Cloud Deploy | `gcp:cloud-deploy` | category → `devops` | — | guide | legacy: `cloud_deploy` |
| Container Registry | `gcp:container-registry` | category → `devops` | `gcr` | guide | legacy: `container_registry` Deprecated in favor of Artifact Registry. |
| Artifact Analysis | `gcp:artifact-analysis` | category → `devops` | `container-analysis` | extension | — |

### Hybrid and Multicloud

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| Anthos ★ | `gcp:anthos` | core | — | guide | legacy: `anthos` |
| Google Distributed Cloud ★ | `gcp:google-distributed-cloud` | core → `distributed-cloud` | `gdc`, `gdc-edge`, `gdc-air-gapped`, `distributed-cloud-edge` | guide | — |
| Anthos Config Management | `gcp:anthos-config-management` | core → `anthos` | `config-sync`, `policy-controller` | extension | legacy: `anthos_config_management` |

### Integration Services

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| Advanced API Security | `gcp:advanced-api-security` | category → `integration-services` | — | guide | — |
| API Analytics | `gcp:api-analytics` | category → `integration-services` | — | guide | legacy: `api_analytics` |
| Apigee ★ | `gcp:apigee` | core | `apigee-x`, `apigee-hybrid`, `apigee-api-platform`, `apigee-api-management` | guide | legacy: `apigee_api_platform` |
| Application Integration | `gcp:application-integration` | category → `integration-services` | — | guide | — |
| Cloud API Gateway | `gcp:cloud-api-gateway` | category → `integration-services` | `api-gateway` | guide | legacy: `cloud_api_gateway` |
| Cloud APIs | `gcp:cloud-apis` | category → `integration-services` | — | guide | legacy: `cloud_apis` |
| Cloud Endpoints | `gcp:cloud-endpoints` | category → `integration-services` | `endpoints` | guide | legacy: `cloud_endpoints` |
| Connectors | `gcp:connectors` | category → `integration-services` | `integration-connectors` | guide | legacy: `connectors` |
| Developer Portal | `gcp:developer-portal` | category → `integration-services` | `apigee-developer-portal` | guide | legacy: `developer_portal` |
| Eventarc | `gcp:eventarc` | category → `integration-services` | — | guide | legacy: `eventarc` |
| Workflows | `gcp:workflows` | category → `integration-services` | `cloud-workflows` | guide | legacy: `workflows` |
| Apigee API hub | `gcp:api-hub` | core → `apigee` | `apigee-api-hub` | extension | — |

### Management Tools

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| Carbon Footprint | `gcp:carbon-footprint` | category → `management-tools` | — | guide | — |
| Producer Portal | `gcp:producer-portal` | category → `management-tools` | — | guide | legacy: `producer_portal` |
| Cloud Billing | `gcp:cloud-billing` | category → `management-tools` | `billing`, `billing-account` | extension | legacy: `billing` |
| Resource Manager | `gcp:resource-manager` | category → `management-tools` | `project`, `folder`, `organization` | extension | legacy: `project` No icon exists for project/folder/organization in the 2025 system. For diagram boundaries prefer a plain `group` with a label (see guide). |
| Cloud Quotas | `gcp:cloud-quotas` | category → `management-tools` | `quotas` | extension | legacy: `quotas` |
| Recommender / Active Assist | `gcp:recommender` | category → `management-tools` | `active-assist` | extension | — |

### Maps & Geospatial

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| Earth Engine ★ | `gcp:earth-engine` | category → `maps-geospatial` | — | guide | Marked core in the guide but no unique icon is shipped; category icon used. |
| Google Earth | `gcp:google-earth` | category → `maps-geospatial` | — | guide | — |
| Google Maps Platform ★ | `gcp:google-maps-platform` | category → `maps-geospatial` | `maps-platform`, `maps` | guide | legacy: `google_maps_platform` Marked core in the guide but no unique icon is shipped; Google Maps marks have separate brand guidelines. Category icon used. |

### Google Cloud Marketplace

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| Google Cloud Marketplace | `gcp:google-cloud-marketplace` | category → `marketplace` | `cloud-marketplace` | guide | legacy: `google_cloud_marketplace` |

### Media Services

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| Live Stream API | `gcp:live-stream-api` | category → `media-services` | — | extension | — |
| Transcoder API | `gcp:transcoder-api` | category → `media-services` | — | extension | — |
| Video Stitcher API | `gcp:video-stitcher-api` | category → `media-services` | — | extension | — |

### Migration

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| Migrate for Compute Engine | `gcp:migrate-for-compute-engine` | category → `migration` | — | guide | legacy: `migrate_for_compute_engine` Superseded by Migrate to Virtual Machines (Compute category). |
| Transfer Appliance | `gcp:transfer-appliance` | category → `migration` | — | guide | legacy: `transfer_appliance` |
| Migration Center | `gcp:migration-center` | category → `migration` | — | extension | — |
| Rapid Migration Assessment | `gcp:rapid-migration-assessment` | category → `migration` | — | extension | — |

### Mixed Reality

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| Immersive Stream for XR | `gcp:immersive-stream-for-xr` | category → `mixed-reality` | — | extension | — |

### Networking

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| Cloud Armor | `gcp:cloud-armor` | category → `networking` | `armor`, `waf` | guide | legacy: `cloud_armor` |
| Cloud CDN | `gcp:cloud-cdn` | category → `networking` | `cdn` | guide | legacy: `cloud_cdn` |
| Cloud DNS | `gcp:cloud-dns` | category → `networking` | `dns` | guide | legacy: `cloud_dns` |
| Cloud Domains | `gcp:cloud-domains` | category → `networking` | — | guide | legacy: `cloud_domains` |
| Cloud Firewall Rules | `gcp:cloud-firewall-rules` | category → `networking` | `cloud-firewall`, `firewall`, `cloud-ngfw`, `firewall-policy` | guide | legacy: `cloud_firewall_rules` |
| Cloud IDS | `gcp:cloud-ids` | category → `networking` | `ids` | guide | legacy: `cloud_ids` |
| Cloud Interconnect | `gcp:cloud-interconnect` | category → `networking` | `interconnect`, `dedicated-interconnect`, `cross-cloud-interconnect` | guide | legacy: `cloud_interconnect` |
| Cloud Load Balancing | `gcp:cloud-load-balancing` | category → `networking` | `load-balancing`, `load-balancer`, `lb`, `cloud-lb`, `application-load-balancer`, `network-load-balancer` | guide | legacy: `cloud_load_balancing` |
| Cloud NAT | `gcp:cloud-nat` | category → `networking` | `nat` | guide | legacy: `cloud_nat` |
| Cloud Network | `gcp:cloud-network` | category → `networking` | — | guide | legacy: `cloud_network` |
| Cloud Router | `gcp:cloud-router` | category → `networking` | `router` | guide | legacy: `cloud_router` |
| Cloud VPN | `gcp:cloud-vpn` | category → `networking` | `vpn`, `ha-vpn` | guide | legacy: `cloud_vpn` |
| Connectivity Test | `gcp:connectivity-test` | category → `networking` | `connectivity-tests` | guide | legacy: `connectivity_test` |
| Data Transfer | `gcp:data-transfer` | category → `networking` | — | guide | legacy: `data_transfer` |
| Network Connectivity Center | `gcp:network-connectivity-center` | category → `networking` | `ncc` | guide | legacy: `network_connectivity_center` |
| Network Intelligence Center | `gcp:network-intelligence-center` | category → `networking` | — | guide | legacy: `network_intelligence_center` |
| Network Security | `gcp:network-security` | category → `networking` | — | guide | legacy: `network_security` |
| Network Tiers | `gcp:network-tiers` | category → `networking` | `network-service-tiers`, `standard-network-tier` | guide | legacy: `network_tiers` |
| Network Topology | `gcp:network-topology` | category → `networking` | — | guide | legacy: `network_topology` |
| Packet Mirroring | `gcp:packet-mirroring` | category → `networking` | — | guide | — |
| Partner Interconnect | `gcp:partner-interconnect` | category → `networking` | — | guide | legacy: `partner_interconnect` |
| Premium Network Tier | `gcp:premium-network-tier` | category → `networking` | — | guide | legacy: `premium_network_tier` |
| Private Connectivity | `gcp:private-connectivity` | category → `networking` | `private-google-access`, `private-services-access` | guide | legacy: `private_connectivity` |
| Private Service Connect | `gcp:private-service-connect` | category → `networking` | `psc` | guide | legacy: `private_service_connect` |
| Routes | `gcp:routes` | category → `networking` | `cloud-routes` | guide | legacy: `cloud_routes` |
| Service Mesh | `gcp:service-mesh` | category → `networking` | `cloud-service-mesh`, `anthos-service-mesh`, `traffic-director` | guide | legacy: `anthos_service_mesh` |
| Virtual Private Cloud | `gcp:virtual-private-cloud` | category → `networking` | `vpc`, `shared-vpc`, `subnet`, `vpc-network` | guide | legacy: `virtual_private_cloud` |
| Media CDN | `gcp:media-cdn` | category → `networking` | — | extension | legacy: `cloud_media_edge` |
| Service Directory | `gcp:service-directory` | category → `networking` | — | extension | legacy: `service_discovery` |
| External IP Addresses | `gcp:external-ip-addresses` | category → `networking` | `cloud-external-ip-addresses`, `static-ip` | extension | legacy: `cloud_external_ip_addresses` |

### Observability

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| Cloud Audit Logs | `gcp:cloud-audit-logs` | category → `observability` | `audit-logs` | guide | legacy: `cloud_audit_logs` |
| Cloud Logging | `gcp:cloud-logging` | category → `observability` | `logging` | guide | legacy: `cloud_logging` |
| Cloud Monitoring | `gcp:cloud-monitoring` | category → `observability` | `monitoring` | guide | legacy: `cloud_monitoring` |
| Error Reporting | `gcp:error-reporting` | category → `observability` | — | guide | legacy: `error_reporting` |
| Google Cloud Observability | `gcp:google-cloud-observability` | category → `observability` | `cloud-observability`, `operations-suite`, `cloud-ops`, `stackdriver` | guide | legacy: `cloud_ops` |
| Profiler | `gcp:profiler` | category → `observability` | `cloud-profiler` | guide | legacy: `profiler` |
| Trace | `gcp:trace` | category → `observability` | `cloud-trace` | guide | legacy: `trace` |
| Managed Service for Prometheus | `gcp:managed-service-for-prometheus` | category → `observability` | `gmp`, `managed-prometheus` | extension | — |

### Operations

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| App Hub | `gcp:app-hub` | category → `operations` | — | guide | — |
| Backup and DR | `gcp:backup-and-dr` | category → `operations` | `backup-dr`, `backup-and-dr-service` | guide | — |
| Capacity Planner | `gcp:capacity-planner` | category → `operations` | — | guide | — |
| Performance Dashboard | `gcp:performance-dashboard` | category → `operations` | — | guide | legacy: `performance_dashboard` |
| Personalized Service Health | `gcp:personalized-service-health` | category → `operations` | `service-health` | guide | — |

### Security and Identity

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| Access Context Manager | `gcp:access-context-manager` | category → `security-identity` | `access-levels` | guide | legacy: `access_context_manager` |
| Asset Inventory | `gcp:asset-inventory` | category → `security-identity` | — | guide | legacy: `asset_inventory` |
| Assured Workloads | `gcp:assured-workloads` | category → `security-identity` | — | guide | legacy: `assured_workloads` |
| BeyondCorp | `gcp:beyondcorp` | category → `security-identity` | `beyondcorp-enterprise`, `chrome-enterprise-premium` | guide | legacy: `beyondcorp` |
| Binary Authorization | `gcp:binary-authorization` | category → `security-identity` | `binauthz` | guide | legacy: `binary_authorization` |
| Certificate Authority Service | `gcp:certificate-authority-service` | category → `security-identity` | `cas`, `ca-service` | guide | legacy: `certificate_authority_service` |
| Certificate Manager | `gcp:certificate-manager` | category → `security-identity` | — | guide | legacy: `certificate_manager` |
| Cloud Asset Inventory | `gcp:cloud-asset-inventory` | category → `security-identity` | — | guide | legacy: `cloud_asset_inventory` |
| Cloud External Key Manager | `gcp:cloud-external-key-manager` | category → `security-identity` | `cloud-ekm`, `ekm` | guide | legacy: `cloud_ekm` |
| Cloud HSM | `gcp:cloud-hsm` | category → `security-identity` | `hsm` | guide | legacy: `cloud_hsm` |
| Cloud Security Scanner | `gcp:cloud-security-scanner` | category → `security-identity` | — | guide | legacy: `cloud_security_scanner` |
| Google Security Operations ★ | `gcp:google-security-operations` | core → `security-operations` | `secops`, `chronicle`, `chronicle-siem`, `chronicle-soar`, `security-operations-soar`, `google-secops` | guide | — |
| Google Threat Intelligence ★ | `gcp:google-threat-intelligence` | core → `threat-intelligence` | `gti` | guide | — |
| Identity and Access Management | `gcp:identity-and-access-management` | category → `security-identity` | `iam`, `cloud-iam`, `service-account` | guide | legacy: `identity_and_access_management` |
| Identity-Aware Proxy | `gcp:identity-aware-proxy` | category → `security-identity` | `iap` | guide | legacy: `identity-aware_proxy` |
| Identity Platform | `gcp:identity-platform` | category → `security-identity` | — | guide | legacy: `identity_platform` |
| Key Access Justifications | `gcp:key-access-justifications` | category → `security-identity` | `kaj` | guide | legacy: `key_access_justifications` |
| Key Management Service | `gcp:key-management-service` | category → `security-identity` | `kms`, `cloud-kms`, `cmek` | guide | legacy: `key_management_service` |
| Managed Service for Microsoft Active Directory | `gcp:managed-service-for-microsoft-active-directory` | category → `security-identity` | `managed-microsoft-ad`, `managed-ad` | guide | legacy: `managed_service_for_microsoft_active_directory` |
| Mandiant ★ | `gcp:mandiant` | core | — | guide | — |
| Phishing Protection | `gcp:phishing-protection` | category → `security-identity` | — | guide | legacy: `phishing_protection` |
| Policy Analyzer | `gcp:policy-analyzer` | category → `security-identity` | — | guide | legacy: `policy_analyzer` |
| reCAPTCHA Enterprise | `gcp:recaptcha-enterprise` | category → `security-identity` | `recaptcha` | guide | — |
| Risk Manager | `gcp:risk-manager` | category → `security-identity` | — | guide | legacy: `risk_manager` |
| Secret Manager | `gcp:secret-manager` | category → `security-identity` | `secrets` | guide | legacy: `secret_manager` |
| Security Command Center ★ | `gcp:security-command-center` | core | `scc`, `security-command-center-enterprise` | guide | legacy: `security_command_center` |
| Security Key Enforcement | `gcp:security-key-enforcement` | category → `security-identity` | — | guide | legacy: `security_key_enforcement` |
| Web Risk | `gcp:web-risk` | category → `security-identity` | — | guide | legacy: `web_risk` |
| Web Security Scanner | `gcp:web-security-scanner` | category → `security-identity` | — | guide | legacy: `web_security_scanner` |
| Workload Identity Federation | `gcp:workload-identity-federation` | category → `security-identity` | `wif`, `workload-identity`, `workload-identity-pool` | guide | legacy: `workload_identity_pool` |
| VPC Service Controls | `gcp:vpc-service-controls` | category → `security-identity` | `vpc-sc`, `service-perimeter` | extension | — |
| Cloud Identity | `gcp:cloud-identity` | category → `security-identity` | — | extension | — |
| Organization Policy Service | `gcp:organization-policy` | category → `security-identity` | `org-policy` | extension | — |

### Serverless Computing

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| App Engine | `gcp:app-engine` | category → `serverless-computing` | `gae` | guide | legacy: `app_engine` |
| Cloud Functions | `gcp:cloud-functions` | category → `serverless-computing` | `functions`, `gcf` | guide | legacy: `cloud_functions` |
| Cloud Run ★ | `gcp:cloud-run` | core | `run`, `cloud-run-functions`, `cloud-run-jobs`, `cloud-run-services`, `cloud-run-worker-pools` | guide | legacy: `cloud_run` |

### Storage

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| Cloud Storage ★ | `gcp:cloud-storage` | core | `gcs`, `bucket`, `cloud-storage-bucket` | guide | legacy: `cloud_storage` |
| Filestore | `gcp:filestore` | category → `storage` | — | guide | legacy: `filestore` |
| Google Cloud NetApp Volumes | `gcp:google-cloud-netapp-volumes` | category → `storage` | `netapp-volumes` | guide | — |
| Hyperdisk ★ | `gcp:hyperdisk` | core | — | guide | Core page lists Hyperdisk '(previously Persistent Disk)'; the Storage category page lists it without the core marker. The unique icon exists in the ZIP, so it is treated as core. |
| Local SSD | `gcp:local-ssd` | category → `storage` | — | guide | legacy: `local_ssd` |
| Parallelstore | `gcp:parallelstore` | category → `storage` | — | guide | — |
| Persistent Disk | `gcp:persistent-disk` | core → `hyperdisk` | `pd` | guide | legacy: `persistent_disk` Mapped to the Hyperdisk core icon per the guide's '(previously Persistent Disk)' note. Use gcp:storage if you want the generic category icon instead. |
| Storage Transfer Service | `gcp:storage-transfer-service` | category → `storage` | `sts` | guide | legacy: `transfer` |

### Web3

| Product | Mermaid icon | Kind | Aliases | Source | Notes |
|---|---|---|---|---|---|
| Blockchain Node Engine | `gcp:blockchain-node-engine` | category → `web3` | — | guide | — |
| Blockchain RPC | `gcp:blockchain-rpc` | category → `web3` | — | guide | — |

★ = marked as a core product in Google's guide.

## Not available in this pack

- **Google Cloud (platform logo)** — The Google Cloud logo is a brand feature outside the product icon set; Google's trademark guidelines restrict logo use to approved partners. Use an unlabeled `group` or the Mermaid default `cloud` icon for the platform boundary.
- **Firebase** — Separate brand program with its own icons/guidelines; not part of the Google Cloud icon set.
- **Gemini logo** — Gemini marks are governed by separate brand guidelines; no icon is shipped in the Google Cloud ZIPs (see the `gemini` product entry fallback).
- **Google Maps / Google Workspace logos** — Separate brand programs; only the category icon is available within this set.

