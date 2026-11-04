// Catalogue des sources ELT (dlt) proposées à la création d'un pipeline
// (spec §Connecteurs). Miroir exact du registre du runner (apps/dlt,
// runner/sources.py, commande `catalog`) : les clés de sources et de champs
// sont les identifiants techniques attendus par le runner - seuls les
// identifiants, pas de secrets (credentials chiffrés au repos, jamais
// renvoyés au client, AGENTS.md §12).
//
// Genèse : régénérer le registre machine via
//   cd apps/dlt && sh run.sh catalog > /tmp/dlt-catalog.json
// puis reporter ici clés et champs (les libellés restent français).
//
// `kind` pilote le wizard :
//   - sql       : test de connexion → introspection réelle des tables ;
//   - endpoints : « tables » = chemins d'endpoints REST (saisie manuelle) ;
//   - globs     : « tables » = globs de fichiers (saisie manuelle) ;
//   - resource  : source verified à ressource unique (kafka, kinesis…) ;
//   - resources : source verified à ressources multiples (introspection).

import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bug,
  Boxes,
  Cloud,
  CreditCard,
  Crown,
  Database,
  FileJson,
  FileText,
  Globe,
  HardDrive,
  Inbox,
  LifeBuoy,
  ListTodo,
  Megaphone,
  MessagesSquare,
  Radio,
  RefreshCw,
  Search,
  ShoppingBag,
  Snowflake,
  Sparkles,
  Table2,
  Target,
  Trello,
  Zap,
} from "lucide-react";

export type SourceKind = "sql" | "endpoints" | "globs" | "resource" | "resources";

export interface SourceField {
  // Identifiant technique (kwargs de la factory dlt ou champ de credentials).
  key: string;
  label: string;
  type?: "text" | "password" | "number";
  placeholder?: string;
  required?: boolean;
}

export interface SourceDefinition {
  key: string;
  label: string;
  category: "Core Sources" | "Verified Sources";
  group: string;
  icon: LucideIcon;
  description: string;
  kind: SourceKind;
  fields: SourceField[];
  // Saisie manuelle des « tables » quand la source n'est pas introspectable.
  tablesHint?: { label: string; placeholder: string; multiple: boolean };
}

export const SOURCE_CATEGORIES: SourceDefinition["category"][] = [
  "Core Sources",
  "Verified Sources",
];

export const CORE_GROUPS = [
  "REST APIs",
  "SQL Databases",
  "Object Store & Filesystem",
];

export const VERIFIED_GROUPS = [
  "CRM/ERP",
  "Marketing",
  "Collaboration",
  "E-commerce",
  "Bases de données",
  "Autres",
];

function sqlFields(opts?: {
  port?: string;
  schema?: string;
  warehouse?: boolean;
  file?: boolean;
}): SourceField[] {
  if (opts?.file) {
    return [
      {
        key: "database",
        label: "Chemin du fichier",
        placeholder: "/data/app.db",
        required: true,
      },
    ];
  }
  const fields: SourceField[] = [
    { key: "host", label: "Hôte", placeholder: "db.exemple.com", required: true },
    {
      key: "port",
      label: "Port",
      type: "number",
      placeholder: opts?.port ?? "5432",
      required: true,
    },
    { key: "database", label: "Base de données", required: true },
    { key: "username", label: "Utilisateur", required: true },
    { key: "password", label: "Mot de passe", type: "password", required: true },
  ];
  if (opts?.schema) {
    fields.push({
      key: "schema",
      label: "Schéma",
      placeholder: opts.schema,
      required: false,
    });
  }
  if (opts?.warehouse) {
    fields.push({
      key: "warehouse",
      label: "Entrepôt (warehouse)",
      required: false,
    });
  }
  return fields;
}

export const SOURCES: SourceDefinition[] = [
  // --- Core Sources : REST APIs -------------------------------------------
  {
    key: "rest_api",
    label: "REST APIs",
    category: "Core Sources",
    group: "REST APIs",
    icon: Globe,
    description:
      "Endpoints HTTP JSON - chaque « table » est un chemin d'endpoint (pagination gérée par dlt).",
    kind: "endpoints",
    fields: [
      {
        key: "base_url",
        label: "URL de base",
        placeholder: "https://api.exemple.com/v1",
        required: true,
      },
      {
        key: "api_key",
        label: "Clé API (Bearer)",
        type: "password",
        required: false,
      },
    ],
    tablesHint: {
      label: "Chemin d'endpoint",
      placeholder: "/users",
      multiple: true,
    },
  },

  // --- Core Sources : SQL Databases (sql_database, dialectes SQLAlchemy) --
  ...(
    [
      ["postgresql", "PostgreSQL", "public", Database],
      ["mysql", "MySQL", null, Database],
      ["mariadb", "MariaDB", null, Database],
      ["sqlserver", "Microsoft SQL Server", "dbo", Database],
      ["cockroachdb", "CockroachDB", "public", Database],
      ["redshift", "Amazon Redshift", "public", Database],
      [
        "sqlite",
        "SQLite",
        null,
        Database,
      ],
    ] as const
  ).map(([key, label, schema, icon]) => ({
    key,
    label,
    category: "Core Sources" as const,
    group: "SQL Databases",
    icon,
    description:
      key === "sqlite"
        ? "Base SQLite locale (fichier) chargée via sql_database."
        : "Base SQL chargée via sql_database (SQLAlchemy), tables, vues et curseur incrémental.",
    kind: "sql" as const,
    fields: sqlFields(key === "sqlite" ? { file: true } : { schema: schema ?? undefined, port: key === "mysql" || key === "mariadb" ? "3306" : key === "sqlserver" ? "1433" : key === "cockroachdb" ? "26257" : key === "redshift" ? "5439" : "5432" }),
  })),
  ...(
    [
      ["oracle", "Oracle", "1521"],
      ["snowflake", "Snowflake", "443"],
      ["bigquery", "Google BigQuery", null],
      ["sap_hana", "SAP HANA", "39017"],
      ["firebird", "Firebird", "3050"],
      ["teradata", "Teradata Vantage", "1025"],
      ["db2", "IBM DB2", "50000"],
    ] as const
  ).map(([key, label, port]) => ({
    key,
    label,
    category: "Core Sources" as const,
    group: "SQL Databases",
    icon: key === "snowflake" ? Snowflake : key === "bigquery" ? Cloud : Database,
    description:
      "Dialecte SQLAlchemy supporté par sql_database - requiert le pilote correspondant dans l'image du runner (voir apps/dlt/README.md).",
    kind: "sql" as const,
    fields: sqlFields({
      port: port ?? undefined,
      warehouse: key === "snowflake",
    }),
  })),

  // --- Core Sources : Object Store & Filesystem (readers dlt) ------------
  {
    key: "filesystem",
    label: "Object Store & Filesystem",
    category: "Core Sources",
    group: "Object Store & Filesystem",
    icon: HardDrive,
    description:
      "Fichiers CSV, Parquet ou JSONL depuis S3 (et compatibles), GCS, Google Drive, Azure Blob, SFTP, filesystem local ou CDN public - chaque « table » est un glob de fichiers.",
    kind: "globs",
    fields: [
      {
        key: "bucket_url",
        label: "URL du bucket",
        placeholder: "s3://mon-bucket/dossier (aussi gs://, az://, sftp://, file://, https://)",
        required: true,
      },
      {
        key: "access_key_id",
        label: "Access Key ID (S3 et compatibles)",
        required: false,
      },
      {
        key: "secret_access_key",
        label: "Secret Access Key",
        type: "password",
        required: false,
      },
      { key: "region", label: "Région", placeholder: "us-east-1", required: false },
      {
        key: "endpoint_url",
        label: "Endpoint (S3 compatible)",
        placeholder: "https://s3.exemple.com",
        required: false,
      },
      {
        key: "account_name",
        label: "Nom de compte (Azure)",
        required: false,
      },
      {
        key: "account_key",
        label: "Clé de compte (Azure)",
        type: "password",
        required: false,
      },
      { key: "username", label: "Utilisateur (SFTP)", required: false },
      { key: "password", label: "Mot de passe (SFTP)", type: "password", required: false },
      {
        key: "credentials",
        label: "Clé service account JSON (GCS/GDrive)",
        type: "password",
        required: false,
      },
    ],
    tablesHint: {
      label: "Glob de fichiers",
      placeholder: "**/*.csv",
      multiple: true,
    },
  },

  // --- Verified Sources : CRM/ERP ------------------------------------------
  {
    key: "salesforce",
    label: "Salesforce",
    category: "Verified Sources",
    group: "CRM/ERP",
    icon: Sparkles,
    description: "Comptes, contacts, opportunités Salesforce (API SOAP/REST).",
    kind: "resources",
    fields: [
      { key: "user_name", label: "Utilisateur", required: true },
      { key: "password", label: "Mot de passe", type: "password", required: true },
      {
        key: "security_token",
        label: "Jeton de sécurité",
        type: "password",
        required: true,
      },
    ],
  },
  {
    key: "hubspot",
    label: "HubSpot",
    category: "Verified Sources",
    group: "CRM/ERP",
    icon: Boxes,
    description: "CRM HubSpot : contacts, entreprises, transactions.",
    kind: "resources",
    fields: [
      { key: "api_key", label: "Clé API (private app)", type: "password", required: true },
    ],
  },
  {
    key: "pipedrive",
    label: "Pipedrive",
    category: "Verified Sources",
    group: "CRM/ERP",
    icon: Trello,
    description: "CRM Pipedrive : activités, transactions, personnes.",
    kind: "resources",
    fields: [
      { key: "pipedrive_api_key", label: "Clé API", type: "password", required: true },
      { key: "since_timestamp", label: "Depuis (horodatage)", required: false },
    ],
  },
  {
    key: "zendesk",
    label: "Zendesk",
    category: "Verified Sources",
    group: "CRM/ERP",
    icon: LifeBuoy,
    description: "Tickets, utilisateurs et organisations Zendesk Support.",
    kind: "resources",
    fields: [
      { key: "subdomain", label: "Sous-domaine", placeholder: "mon-domaine", required: true },
      { key: "email", label: "Email", required: true },
      { key: "password", label: "Mot de passe / jeton API", type: "password", required: true },
      { key: "start_date", label: "Date de début (AAAA-MM-JJ)", required: false },
      { key: "end_date", label: "Date de fin (AAAA-MM-JJ)", required: false },
    ],
  },
  {
    key: "freshdesk",
    label: "Freshdesk",
    category: "Verified Sources",
    group: "CRM/ERP",
    icon: MessagesSquare,
    description: "Tickets Freshdesk.",
    kind: "resources",
    fields: [
      { key: "domain", label: "Domaine", placeholder: "mon-domaine", required: true },
      { key: "api_secret_key", label: "Clé API", type: "password", required: true },
    ],
  },

  // --- Verified Sources : Marketing ----------------------------------------
  {
    key: "google_ads",
    label: "Google Ads",
    category: "Verified Sources",
    group: "Marketing",
    icon: Target,
    description: "Campagnes, groupes d'annonces et performances Google Ads.",
    kind: "resources",
    fields: [
      { key: "client_id", label: "Client ID OAuth", required: false },
      { key: "client_secret", label: "Client Secret OAuth", type: "password", required: false },
      { key: "refresh_token", label: "Refresh token OAuth", type: "password", required: false },
      { key: "dev_token", label: "Developer token", type: "password", required: true },
      { key: "impersonated_email", label: "Email du compte (impersonation)", required: true },
      { key: "project_id", label: "ID de projet GCP", required: false },
    ],
  },
  {
    key: "facebook_ads",
    label: "Facebook Ads",
    category: "Verified Sources",
    group: "Marketing",
    icon: Megaphone,
    description: "Comptes publicitaires, campagnes et statistiques Facebook Ads.",
    kind: "resources",
    fields: [
      { key: "account_id", label: "ID du compte publicitaire", required: true },
      { key: "access_token", label: "Jeton d'accès", type: "password", required: true },
    ],
  },
  {
    key: "google_analytics",
    label: "Google Analytics",
    category: "Verified Sources",
    group: "Marketing",
    icon: BarChart3,
    description: "Rapports et statistiques Google Analytics (Data API).",
    kind: "resources",
    fields: [
      { key: "property_id", label: "ID de propriété GA4", required: true },
      { key: "client_id", label: "Client ID OAuth", required: false },
      { key: "client_secret", label: "Client Secret OAuth", type: "password", required: false },
      { key: "refresh_token", label: "Refresh token OAuth", type: "password", required: false },
      { key: "project_id", label: "ID de projet GCP", required: false },
      { key: "start_date", label: "Date de début (AAAA-MM-JJ)", required: false },
    ],
  },
  {
    key: "matomo",
    label: "Matomo",
    category: "Verified Sources",
    group: "Marketing",
    icon: Search,
    description: "Visites et rapports Matomo Analytics.",
    kind: "resources",
    fields: [
      { key: "api_token", label: "Jeton d'API", type: "password", required: true },
      { key: "url", label: "URL Matomo", placeholder: "https://matomo.exemple.com", required: true },
    ],
  },
  {
    key: "bing_webmaster",
    label: "Bing Webmaster",
    category: "Verified Sources",
    group: "Marketing",
    icon: Search,
    description: "Statistiques de sites Bing Webmaster Tools.",
    kind: "resources",
    fields: [
      { key: "site_urls", label: "URLs des sites", placeholder: "https://exemple.com", required: true },
      { key: "api_key", label: "Clé API", type: "password", required: true },
    ],
  },

  // --- Verified Sources : Collaboration ------------------------------------
  {
    key: "slack",
    label: "Slack",
    category: "Verified Sources",
    group: "Collaboration",
    icon: MessagesSquare,
    description: "Messages, canaux et utilisateurs Slack.",
    kind: "resources",
    fields: [
      { key: "access_token", label: "Bot token (xoxb-…)", type: "password", required: true },
      { key: "start_date", label: "Date de début (AAAA-MM-JJ)", required: false },
      { key: "end_date", label: "Date de fin (AAAA-MM-JJ)", required: false },
    ],
  },
  {
    key: "notion",
    label: "Notion",
    category: "Verified Sources",
    group: "Collaboration",
    icon: FileJson,
    description: "Bases de données Notion (une ressource par base).",
    kind: "resources",
    fields: [
      {
        key: "database_ids",
        label: "IDs des bases Notion (séparés par des virgules)",
        required: true,
      },
      { key: "api_key", label: "Clé API (integration token)", type: "password", required: true },
    ],
  },
  {
    key: "github",
    label: "GitHub",
    category: "Verified Sources",
    group: "Collaboration",
    icon: Bug,
    description: "Réactions, événements et étoiles d'un dépôt GitHub.",
    kind: "resources",
    fields: [
      { key: "owner", label: "Propriétaire du dépôt", required: true },
      { key: "name", label: "Nom du dépôt", required: true },
      { key: "access_token", label: "Personal access token", type: "password", required: true },
    ],
  },
  {
    key: "jira",
    label: "Jira",
    category: "Verified Sources",
    group: "Collaboration",
    icon: Trello,
    description: "Tickets Jira (issues, sprint, worklog).",
    kind: "resources",
    fields: [
      { key: "subdomain", label: "Sous-domaine", placeholder: "mon-domaine.atlassian.net", required: true },
      { key: "email", label: "Email", required: true },
      { key: "api_token", label: "Jeton API", type: "password", required: true },
    ],
  },
  {
    key: "asana",
    label: "Asana",
    category: "Verified Sources",
    group: "Collaboration",
    icon: ListTodo,
    description: "Projets, tâches et sections Asana.",
    kind: "resources",
    fields: [
      { key: "pat", label: "Personal access token", type: "password", required: true },
    ],
  },
  {
    key: "workable",
    label: "Workable",
    category: "Verified Sources",
    group: "Collaboration",
    icon: Zap,
    description: "Offres et candidatures Workable.",
    kind: "resources",
    fields: [
      { key: "access_token", label: "Clé API", type: "password", required: true },
      { key: "subdomain", label: "Sous-domaine", required: false },
      { key: "start_date", label: "Date de début (AAAA-MM-JJ)", required: false },
    ],
  },
  {
    key: "google_sheets",
    label: "Google Sheets",
    category: "Verified Sources",
    group: "Collaboration",
    icon: FileText,
    description: "Feuilles Google Sheets (une ressource par plage nommée ou feuille).",
    kind: "resources",
    fields: [
      { key: "spreadsheet_url_or_id", label: "URL ou ID du tableur", required: true },
      { key: "client_id", label: "Client ID OAuth", required: false },
      { key: "client_secret", label: "Client Secret OAuth", type: "password", required: false },
      { key: "refresh_token", label: "Refresh token OAuth", type: "password", required: false },
      { key: "project_id", label: "ID de projet GCP", required: false },
    ],
  },

  // --- Verified Sources : E-commerce ---------------------------------------
  {
    key: "shopify",
    label: "Shopify",
    category: "Verified Sources",
    group: "E-commerce",
    icon: ShoppingBag,
    description: "Commandes et produits Shopify (Admin API).",
    kind: "resources",
    fields: [
      { key: "shop_url", label: "URL de la boutique", placeholder: "ma-boutique.myshopify.com", required: true },
      { key: "private_app_password", label: "Access token (app privée)", type: "password", required: true },
      { key: "api_version", label: "Version d'API", placeholder: "2026-01", required: false },
      { key: "start_date", label: "Date de début (AAAA-MM-JJ)", required: false },
    ],
  },
  {
    key: "stripe",
    label: "Stripe",
    category: "Verified Sources",
    group: "E-commerce",
    icon: CreditCard,
    description: "Paiements, clients et abonnements Stripe (chargement incrémental).",
    kind: "resources",
    fields: [
      { key: "stripe_secret_key", label: "Clé secrète (sk_…)", type: "password", required: true },
      { key: "endpoints", label: "Endpoints (séparés par des virgules)", required: false },
      { key: "initial_start_date", label: "Date de début (AAAA-MM-JJ)", required: false },
    ],
  },

  // --- Verified Sources : Bases de données ---------------------------------
  {
    key: "mongodb",
    label: "MongoDB",
    category: "Verified Sources",
    group: "Bases de données",
    icon: Table2,
    description: "Collections MongoDB.",
    kind: "resources",
    fields: [
      { key: "connection_url", label: "URI de connexion", type: "password", required: true },
      { key: "database", label: "Base de données", required: false },
    ],
  },
  {
    key: "postgres_replication",
    label: "PostgreSQL Replication",
    category: "Verified Sources",
    group: "Bases de données",
    icon: RefreshCw,
    description:
      "Réplication logique PostgreSQL (slot et publication créés en amont sur la base source).",
    kind: "resource",
    fields: [
      { key: "host", label: "Hôte", required: true },
      { key: "port", label: "Port", type: "number", placeholder: "5432", required: true },
      { key: "database", label: "Base de données", required: true },
      { key: "username", label: "Utilisateur", required: true },
      { key: "password", label: "Mot de passe", type: "password", required: true },
      { key: "slot_name", label: "Nom du slot de réplication", required: true },
      { key: "pub_name", label: "Nom de la publication", required: true },
    ],
  },

  // --- Verified Sources : Autres -------------------------------------------
  {
    key: "airtable",
    label: "Airtable",
    category: "Verified Sources",
    group: "Autres",
    icon: Table2,
    description: "Bases Airtable.",
    kind: "resources",
    fields: [
      { key: "base_id", label: "ID de base", placeholder: "appXXXXXXXX", required: true },
      { key: "table_names", label: "Noms de tables (séparés par des virgules)", required: false },
      { key: "access_token", label: "Jeton d'accès", type: "password", required: true },
    ],
  },
  {
    key: "amazon_kinesis",
    label: "Amazon Kinesis",
    category: "Verified Sources",
    group: "Autres",
    icon: Zap,
    description: "Flux de messages Amazon Kinesis (un flux par pipeline).",
    kind: "resource",
    fields: [
      { key: "aws_access_key_id", label: "Access Key ID", required: true },
      { key: "aws_secret_access_key", label: "Secret Access Key", type: "password", required: true },
      { key: "region_name", label: "Région", placeholder: "eu-west-3", required: false },
    ],
    tablesHint: {
      label: "Nom du flux (stream)",
      placeholder: "mon-flux",
      multiple: false,
    },
  },
  {
    key: "kafka",
    label: "Apache Kafka",
    category: "Verified Sources",
    group: "Autres",
    icon: Radio,
    description: "Topics Kafka - une table par topic, offsets suivis incrémentalement.",
    kind: "resource",
    fields: [
      { key: "bootstrap_servers", label: "Serveurs (bootstrap)", placeholder: "broker1:9092", required: true },
      { key: "group_id", label: "Group ID du consommateur", required: true },
      { key: "security_protocol", label: "Protocole de sécurité", placeholder: "SASL_SSL", required: true },
      { key: "sasl_mechanisms", label: "Mécanisme SASL", required: false },
      { key: "sasl_username", label: "Utilisateur SASL", required: false },
      { key: "sasl_password", label: "Mot de passe SASL", type: "password", required: false },
    ],
    tablesHint: {
      label: "Topic Kafka",
      placeholder: "mon-topic",
      multiple: true,
    },
  },
  {
    key: "chess",
    label: "Chess",
    category: "Verified Sources",
    group: "Autres",
    icon: Crown,
    description: "Parties d'échecs par joueur (chess.com).",
    kind: "resources",
    fields: [
      { key: "players", label: "Joueur(s), séparés par des virgules", placeholder: "MagnusCarlsen", required: true },
      { key: "start_month", label: "Mois de début (AAAA-MM)", required: false },
      { key: "end_month", label: "Mois de fin (AAAA-MM)", required: false },
    ],
  },
  {
    key: "inbox",
    label: "Inbox",
    category: "Verified Sources",
    group: "Autres",
    icon: Inbox,
    description: "Boîte email IMAP - messages et pièces jointes.",
    kind: "resources",
    fields: [
      { key: "host", label: "Hôte IMAP", placeholder: "imap.exemple.com", required: true },
      { key: "email_account", label: "Compte email", required: true },
      { key: "password", label: "Mot de passe", type: "password", required: true },
      { key: "folder", label: "Dossier", placeholder: "INBOX", required: false },
      { key: "start_date", label: "Date de début (AAAA-MM-JJ)", required: false },
    ],
  },
  {
    key: "mux",
    label: "Mux",
    category: "Verified Sources",
    group: "Autres",
    icon: BarChart3,
    description: "Vidéos et données de lecture Mux.",
    kind: "resources",
    fields: [
      { key: "access_token", label: "Jeton d'accès", type: "password", required: true },
    ],
  },
  {
    key: "personio",
    label: "Personio",
    category: "Verified Sources",
    group: "Autres",
    icon: FileText,
    description: "Répertoire RH Personio (employés, absences).",
    kind: "resources",
    fields: [
      { key: "client_id", label: "Client ID", required: true },
      { key: "client_secret", label: "Client Secret", type: "password", required: true },
    ],
  },
  {
    key: "strapi",
    label: "Strapi",
    category: "Verified Sources",
    group: "Autres",
    icon: FileJson,
    description: "Contenus Strapi (API REST).",
    kind: "resources",
    fields: [
      { key: "domain", label: "Domaine", placeholder: "https://cms.exemple.com", required: true },
      { key: "api_secret_key", label: "Clé API", type: "password", required: true },
      { key: "endpoints", label: "Endpoints (séparés par des virgules)", required: true },
    ],
  },
];

export function findSource(key: string): SourceDefinition | undefined {
  return SOURCES.find((s) => s.key === key);
}

// Sources exigeant une saisie manuelle des « tables » quand l'introspection
// ne liste rien (sécurité du wizard : liste vide ≠ aucune table requise).
export function requiresManualTables(source: SourceDefinition): boolean {
  return source.kind === "endpoints" || source.kind === "globs";
}
