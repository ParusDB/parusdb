// Catalogue des sources ELT (dlt) proposées à la création d'un pipeline
// (spec §Connecteurs — sous-ensemble des Core et Verified Sources).
// Les identifiants de sources restent en anglais (convention §6) ; seuls les
// identifiants techniques, pas de secrets : les credentials saisis sont
// chiffrés au repos et jamais renvoyés au client.
// NB : l'exécution ELT (dlt) n'est pas encore intégrée : le parcours est
// mocké côté interface (statuts, test de connexion et exécutions simulés).

import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  Database,
  FileJson,
  FileText,
  FolderOpen,
  Globe,
  HardDrive,
  MessagesSquare,
  ShoppingBag,
  Table2,
  Cloud,
  Trello,
  Bug,
  CreditCard,
  Sparkles,
} from "lucide-react";

export interface SourceField {
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
  icon: LucideIcon;
  description: string;
  fields: SourceField[];
  // Tables proposées (mockées) à l'étape de sélection.
  sampleTables: string[];
}

export const SOURCE_CATEGORIES: SourceDefinition["category"][] = [
  "Core Sources",
  "Verified Sources",
];

export const SOURCES: SourceDefinition[] = [
  {
    key: "rest_api",
    label: "REST APIs",
    category: "Core Sources",
    icon: Globe,
    description: "Endpoints HTTP JSON, pagination et authentification.",
    fields: [
      { key: "base_url", label: "URL de base", placeholder: "https://api.exemple.com/v1", required: true },
      { key: "api_key", label: "Clé API", type: "password", required: true },
    ],
    sampleTables: ["users", "orders", "products"],
  },
  {
    key: "postgresql",
    label: "PostgreSQL",
    category: "Core Sources",
    icon: Database,
    description: "Réplication logique ou requêtes incrémentales.",
    fields: [
      { key: "host", label: "Hôte", placeholder: "db.exemple.com", required: true },
      { key: "port", label: "Port", type: "number", placeholder: "5432" },
      { key: "database", label: "Base de données", required: true },
      { key: "username", label: "Utilisateur", required: true },
      { key: "password", label: "Mot de passe", type: "password", required: true },
    ],
    sampleTables: ["customers", "orders", "invoices", "products"],
  },
  {
    key: "mysql",
    label: "MySQL",
    category: "Core Sources",
    icon: Database,
    description: "Base MySQL / MariaDB, chargement incrémental.",
    fields: [
      { key: "host", label: "Hôte", required: true },
      { key: "port", label: "Port", type: "number", placeholder: "3306" },
      { key: "database", label: "Base de données", required: true },
      { key: "username", label: "Utilisateur", required: true },
      { key: "password", label: "Mot de passe", type: "password", required: true },
    ],
    sampleTables: ["clients", "commandes"],
  },
  {
    key: "sqlserver",
    label: "Microsoft SQL Server",
    category: "Core Sources",
    icon: Database,
    description: "Base SQL Server, vues et tables.",
    fields: [
      { key: "host", label: "Hôte", required: true },
      { key: "port", label: "Port", type: "number", placeholder: "1433" },
      { key: "database", label: "Base de données", required: true },
      { key: "username", label: "Utilisateur", required: true },
      { key: "password", label: "Mot de passe", type: "password", required: true },
    ],
    sampleTables: ["sales", "accounts"],
  },
  {
    key: "aws_s3",
    label: "AWS S3",
    category: "Core Sources",
    icon: HardDrive,
    description: "Fichiers CSV/Parquet sur object store S3.",
    fields: [
      { key: "bucket_url", label: "URL du bucket", placeholder: "s3://mon-bucket", required: true },
      { key: "access_key_id", label: "Access Key ID", required: true },
      { key: "secret_access_key", label: "Secret Access Key", type: "password", required: true },
    ],
    sampleTables: ["exports/2026", "exports/2025"],
  },
  {
    key: "gcs",
    label: "Google Cloud Storage",
    category: "Core Sources",
    icon: Cloud,
    description: "Fichiers sur GCS, credentials service account.",
    fields: [
      { key: "bucket_url", label: "URL du bucket", placeholder: "gs://mon-bucket", required: true },
      { key: "credentials", label: "Clé service account (JSON)", type: "password", required: true },
    ],
    sampleTables: ["data/export"],
  },
  {
    key: "filesystem",
    label: "Filesystem local",
    category: "Core Sources",
    icon: FolderOpen,
    description: "Répertoire local ou monté sur le serveur.",
    fields: [
      { key: "path", label: "Chemin", placeholder: "/data/exports", required: true },
    ],
    sampleTables: ["ventes.csv", "stock.csv"],
  },
  {
    key: "sftp",
    label: "SFTP",
    category: "Core Sources",
    icon: FileText,
    description: "Système de fichiers distant SFTP.",
    fields: [
      { key: "host", label: "Hôte", required: true },
      { key: "port", label: "Port", type: "number", placeholder: "22" },
      { key: "username", label: "Utilisateur", required: true },
      { key: "password", label: "Mot de passe", type: "password", required: true },
    ],
    sampleTables: ["export/daily"],
  },
  {
    key: "salesforce",
    label: "Salesforce",
    category: "Verified Sources",
    icon: Sparkles,
    description: "Objets Salesforce (comptes, opportunités).",
    fields: [
      { key: "domain", label: "Domaine", placeholder: "https://mon-domaine.my.salesforce.com", required: true },
      { key: "client_id", label: "Client ID", required: true },
      { key: "client_secret", label: "Client Secret", type: "password", required: true },
    ],
    sampleTables: ["Account", "Opportunity", "Contact"],
  },
  {
    key: "hubspot",
    label: "HubSpot",
    category: "Verified Sources",
    icon: Boxes,
    description: "CRM HubSpot : contacts, deals, entreprises.",
    fields: [
      { key: "access_token", label: "Access Token (private app)", type: "password", required: true },
    ],
    sampleTables: ["contacts", "deals", "companies"],
  },
  {
    key: "notion",
    label: "Notion",
    category: "Verified Sources",
    icon: FileJson,
    description: "Bases de données Notion.",
    fields: [
      { key: "api_key", label: "Clé API (integration token)", type: "password", required: true },
    ],
    sampleTables: ["crm", "roadmap"],
  },
  {
    key: "github",
    label: "GitHub",
    category: "Verified Sources",
    icon: Bug,
    description: "Issues, dépôts, releases.",
    fields: [
      { key: "api_key", label: "Personal access token", type: "password", required: true },
    ],
    sampleTables: ["issues", "pull_requests"],
  },
  {
    key: "jira",
    label: "Jira",
    category: "Verified Sources",
    icon: Trello,
    description: "Tickets et projets Jira.",
    fields: [
      { key: "domain", label: "Domaine", placeholder: "https://mon-domaine.atlassian.net", required: true },
      { key: "email", label: "Email", required: true },
      { key: "api_token", label: "API token", type: "password", required: true },
    ],
    sampleTables: ["issues", "projects"],
  },
  {
    key: "slack",
    label: "Slack",
    category: "Verified Sources",
    icon: MessagesSquare,
    description: "Messages et canaux Slack.",
    fields: [
      { key: "bot_token", label: "Bot token (xoxb-…)", type: "password", required: true },
    ],
    sampleTables: ["messages", "channels"],
  },
  {
    key: "stripe",
    label: "Stripe",
    category: "Verified Sources",
    icon: CreditCard,
    description: "Paiements, clients, abonnements Stripe.",
    fields: [
      { key: "api_key", label: "Clé secrète (sk_…)", type: "password", required: true },
    ],
    sampleTables: ["charges", "customers", "subscriptions", "invoices"],
  },
  {
    key: "shopify",
    label: "Shopify",
    category: "Verified Sources",
    icon: ShoppingBag,
    description: "Commandes et produits Shopify.",
    fields: [
      { key: "store_url", label: "URL de la boutique", placeholder: "https://ma-boutique.myshopify.com", required: true },
      { key: "access_token", label: "Access token (Admin API)", type: "password", required: true },
    ],
    sampleTables: ["orders", "products", "customers"],
  },
  {
    key: "mongodb",
    label: "MongoDB",
    category: "Verified Sources",
    icon: Table2,
    description: "Collections MongoDB.",
    fields: [
      { key: "connection_string", label: "URI de connexion", type: "password", required: true },
      { key: "database", label: "Base de données", required: true },
    ],
    sampleTables: ["orders", "events"],
  },
];

export function findSource(key: string): SourceDefinition | undefined {
  return SOURCES.find((s) => s.key === key);
}
