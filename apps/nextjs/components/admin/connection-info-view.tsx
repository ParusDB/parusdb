"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CharbonPanel } from "@/components/parus/charbon-panel";
import type { ConnectionEndpoints } from "@/lib/connection-info";

// Informations de connexion du lakehouse pour les outils data
// (rbac_refonte.md §5.3). Les snippets sont préremplis avec le compte
// applicatif sélectionné et son scope dédié ; le clientSecret n'est jamais
// stocké — il est affiché une seule fois à la création/réinitialisation.

export interface AppUserConnection {
  id: string;
  name: string;
  clientId: string;
  roleKey: string;
  roleName: string;
  catalogs: string[];
}

const SECRET_PLACEHOLDER = "<votre client secret>";
const TRINO_PASSWORD_PLACEHOLDER = "<votre mot de passe Trino>";

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="mono max-h-[22rem] overflow-auto rounded-2xl border border-border bg-charbon p-4 pr-14 text-xs leading-relaxed text-blanc">
        <code>{code}</code>
      </pre>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Copier"
        className="absolute right-3 top-3 border-white/10 bg-white/5 text-blanc hover:bg-white/10 hover:text-jaune"
        onClick={() => {
          void navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            toast.success("Copié.");
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-olive" strokeWidth={2} />
        ) : (
          <Copy className="h-3.5 w-3.5" strokeWidth={1.6} />
        )}
      </Button>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-3xl border border-border bg-card p-5 sm:p-6">
      <div>
        <h2 className="font-display text-lg">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <code className="mono truncate text-sm">{value}</code>
    </div>
  );
}

export function ConnectionInfoView({
  endpoints,
  appUsers,
  s3Keys,
}: {
  endpoints: ConnectionEndpoints;
  appUsers: AppUserConnection[];
  s3Keys: { accessKeyId: string; secretAccessKey: string } | null;
}) {
  const [appUserId, setAppUserId] = useState(appUsers[0]?.id ?? "");
  const selected = appUsers.find((a) => a.id === appUserId) ?? null;
  const [catalog, setCatalog] = useState(selected?.catalogs[0] ?? "");
  const [showS3Keys, setShowS3Keys] = useState(false);

  // Le catalogue suit le compte applicatif sélectionné (ses droits).
  const effectiveCatalog = useMemo(() => {
    if (selected?.catalogs.includes(catalog)) return catalog;
    return selected?.catalogs[0] ?? "";
  }, [selected, catalog]);

  const credential = selected
    ? `${selected.clientId}:${SECRET_PLACEHOLDER}`
    : `un compte applicatif (${SECRET_PLACEHOLDER})`;
  const scope = selected
    ? `PRINCIPAL_ROLE:${selected.roleKey}`
    : "PRINCIPAL_ROLE:<votre rôle>";

  const warehouse = effectiveCatalog || "<catalogue>";
  // Utilisateur Trino des outils SQL : le compte applicatif sélectionné (le
  // compte de service BFF ne quitte jamais le serveur).
  const trinoSqlUser = selected?.name ?? "<compte applicatif>";
  const trinoCertNote = "/chemin/vers/parus-trino.crt";

  const dbtSnippet = `# ~/.dbt/profiles.yml  (pip install dbt-trino)
parusdb:
  target: parus
  outputs:
    parus:
      type: trino
      method: ldap           # authentification par mot de passe (durcissement)
      user: ${trinoSqlUser}
      password: ${TRINO_PASSWORD_PLACEHOLDER}
      host: ${endpoints.trinoHost}
      port: ${endpoints.trinoPort}
      http_scheme: https     # certificat autosigné : réseau privé
      database: ${warehouse}  # le catalogue Polaris
      schema: analytics      # le schéma (namespace) cible
      threads: 4
      # Certificat autosigné : copiez apps/trino/etc/keystore.crt côté client
      # et indiquez son chemin (sinon la validation TLS échoue) :
      # cert: ${trinoCertNote}`;

  const jdbcSnippet = `jdbc:trino://${endpoints.trinoHost}:${endpoints.trinoPort}/${warehouse}?user=${trinoSqlUser}&password=${TRINO_PASSWORD_PLACEHOLDER}&SSL=true&SSLVerification=NONE
# SSLVerification=NONE : certificat autosigné (réseau privé). Alternative
# recommandée si le client sort du réseau privé : SSLTrustStorePath avec un
# truststore contenant apps/trino/etc/keystore.crt.`;

  const powerbiSnippet = `Host: ${endpoints.trinoHost}
Port: ${endpoints.trinoPort}
Catalog: ${warehouse}
Authentification: nom d'utilisateur et mot de passe
Utilisateur: ${trinoSqlUser}
Mot de passe: ${TRINO_PASSWORD_PLACEHOLDER}

# Propriétés ODBC (chaîne de connexion) — certificat autosigné :
#   SSL=1;AllowSelfSignedServerCert=1`;

  const sparkSnippet = `bin/spark-sql \\
    --packages org.apache.iceberg:iceberg-spark-runtime-4.1_2.13:1.12.0,org.apache.iceberg:iceberg-aws-bundle:1.12.0 \\
    --conf spark.sql.extensions=org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions \\
    --conf spark.sql.catalog.parusdb=org.apache.iceberg.spark.SparkCatalog \\
    --conf spark.sql.catalog.parusdb.type=rest \\
    --conf spark.sql.catalog.parusdb.uri=${endpoints.polarisRestUri} \\
    --conf spark.sql.catalog.parusdb.oauth2-server-uri=${endpoints.polarisTokenUri} \\
    --conf spark.sql.catalog.parusdb.warehouse=${warehouse} \\
    --conf spark.sql.catalog.parusdb.credential=${credential} \\
    --conf spark.sql.catalog.parusdb.scope=${scope} \\
    --conf spark.sql.catalog.parusdb.header.X-Iceberg-Access-Delegation=vended-credentials`;

  const flinkSnippet = `-- Flink SQL
CREATE CATALOG parusdb WITH (
  'type'='iceberg',
  'catalog-type'='rest',
  'uri'='${endpoints.polarisRestUri}',
  'warehouse'='${warehouse}',
  'credential'='${credential}',
  'scope'='${scope}',
  'oauth2-server-uri'='${endpoints.polarisTokenUri}',
  'header.X-Iceberg-Access-Delegation'='vended-credentials'
);`;

  const pyicebergSnippet = `from pyiceberg.catalog.rest import RestCatalog

catalog = RestCatalog(
    name="parusdb",
    **{
        "uri": "${endpoints.polarisRestUri}",
        "warehouse": "${warehouse}",
        "credential": "${credential}",
        "scope": "${scope}",
        "oauth2-server-uri": "${endpoints.polarisTokenUri}",
        "header.X-Iceberg-Access-Delegation": "vended-credentials",
    },
)`;

  return (
    <div className="space-y-6">
      {/* Avertissement sécurité */}
      <div className="flex items-start gap-3 rounded-2xl border border-jaune/40 bg-jaune/10 px-4 py-3">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-charbon" strokeWidth={1.8} />
        <p className="text-sm text-charbon">
          Trino est durci (HTTPS + mot de passe) mais le certificat est
          autosigné et les connexions restent non chiffrées côté Polaris :
          réservez ces adresses au réseau privé. Chaque compte applicatif
          reçoit deux secrets — client Polaris (Iceberg REST) et mot de
          passe Trino (SQL) — limités aux droits de son rôle : un outil ne
          voit que les catalogues accordés.
        </p>
      </div>

      {/* Sélecteurs */}
      <div className="grid gap-4 rounded-3xl border border-border bg-card p-5 sm:grid-cols-2 sm:p-6">
        <div className="grid gap-2">
          <Label>Compte applicatif</Label>
          {appUsers.length > 0 ? (
            <Select
              value={appUserId}
              onValueChange={(value) => {
                setAppUserId(value);
                setCatalog("");
              }}
            >
              <SelectTrigger aria-label="Compte applicatif">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {appUsers.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} · {a.roleName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm text-muted-foreground">
              Aucun compte applicatif : créez-en un dans{" "}
              <a href="/admin/users" className="underline underline-offset-4 hover:text-jaune">
                Utilisateurs → Applicatifs
              </a>{" "}
              pour obtenir des credentials dédiées.
            </p>
          )}
        </div>
        <div className="grid gap-2">
          <Label>Catalogue (warehouse)</Label>
          {selected && selected.catalogs.length > 0 ? (
            <Select value={effectiveCatalog} onValueChange={setCatalog}>
              <SelectTrigger aria-label="Catalogue">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {selected.catalogs.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm text-muted-foreground">
              {selected
                ? "Le rôle de ce compte n'a accès à aucun catalogue : distribuez des droits via /admin/roles."
                : "—"}
            </p>
          )}
        </div>
        {selected ? (
          <p className="mono text-xs text-muted-foreground sm:col-span-2">
            Client ID : {selected.clientId} · Scope : {scope} · Rôle :{" "}
            {selected.roleName}
          </p>
        ) : null}
      </div>

      {/* Endpoints */}
      <Section
        title="Adresses de la plateforme"
        description="Moteur SQL (Trino), catalogue Iceberg (Polaris REST + OAuth2) et object storage (RustFS S3, path-style)."
      >
        <div>
          <Field label="Trino (SQL, HTTPS + mot de passe)" value={`${endpoints.trinoHost}:${endpoints.trinoPort}`} />
          <Field label="Polaris — API Iceberg REST" value={endpoints.polarisRestUri} />
          <Field label="Polaris — jetons OAuth2" value={endpoints.polarisTokenUri} />
          <Field label="S3 (endpoint, path-style)" value={endpoints.s3Endpoint} />
          <Field label="Bucket lakehouse" value={`s3://${endpoints.s3Bucket}`} />
          <Field label="Région S3" value={endpoints.s3Region} />
          <Field label="Certificat Trino (autosigné)" value="apps/trino/etc/keystore.crt" />
        </div>
        <div className="flex items-center gap-3 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowS3Keys((v) => !v)}
          >
            {showS3Keys ? "Masquer" : "Afficher"} les clés S3
          </Button>
          {s3Keys ? (
            showS3Keys ? (
              <div className="mono flex flex-wrap gap-2 text-xs">
                <Badge variant="outline" className="font-normal">
                  access key : {s3Keys.accessKeyId}
                </Badge>
                <Badge variant="outline" className="font-normal">
                  secret : {s3Keys.secretAccessKey}
                </Badge>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">
                Nécessaires uniquement aux outils qui écrivent directement
                dans S3 (ex. Airbyte) — les clients Iceberg REST reçoivent
                des credentials temporaires de Polaris.
              </span>
            )
          ) : (
            <span className="text-xs text-muted-foreground">
              Clés S3 absentes de la configuration serveur
              (S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY) : relancez le setup
              racine pour les importer.
            </span>
          )}
        </div>
      </Section>

      {/* dbt */}
      <Section
        title="dbt (dbt-trino)"
        description="Transformation des données via Trino : profils dbt, une cible par catalogue. L'utilisateur est le compte applicatif — ses droits Trino suivent les grants de son rôle."
      >
        <CodeBlock code={dbtSnippet} />
      </Section>

      {/* JDBC */}
      <Section
        title="JDBC générique"
        description="Pilote JDBC Trino : DBeaver, DataGrip, Superset et tout client SQL. Basic auth (durcissement)."
      >
        <CodeBlock code={jdbcSnippet} />
      </Section>

      {/* Power BI */}
      <Section
        title="Power BI"
        description="Pas de connecteur natif : driver ODBC Starburst + connecteur « Starburst » dans « Obtenir des données ». L'authentification LDAP (mot de passe) active automatiquement SSL."
      >
        <CodeBlock code={powerbiSnippet} />
      </Section>

      {/* Spark */}
      <Section
        title="Spark"
        description="Catalogue Iceberg REST : Polaris vends des credentials S3 temporaires au chargement des tables (aucune clé statique à configurer)."
      >
        <CodeBlock code={sparkSnippet} />
      </Section>

      {/* Flink */}
      <Section
        title="Flink"
        description="Catalogue Iceberg REST, mêmes credentials que Spark."
      >
        <CodeBlock code={flinkSnippet} />
      </Section>

      {/* pyiceberg */}
      <Section
        title="pyiceberg"
        description="Lecture/écriture des tables Iceberg depuis Python."
      >
        <CodeBlock code={pyicebergSnippet} />
      </Section>

      {/* Airbyte */}
      <Section
        title="Airbyte (destination « S3 Data Lake »)"
        description="Le connecteur supporte Polaris nativement : il écrit les fichiers Iceberg dans S3 et enregistre les métadonnées dans le catalogue."
      >
        <div>
          <Field label="Catalog" value="REST → Polaris" />
          <Field label="Polaris Server URI" value={endpoints.polarisRestUri} />
          <Field label="Catalog Name" value={warehouse} />
          <Field label="Client ID" value={selected?.clientId ?? "<créez un compte applicatif>"} />
          <Field label="Client Secret" value={SECRET_PLACEHOLDER} />
          <Field label="OAuth Scope" value={scope} />
          <Field label="OAuth2 Server URI" value={endpoints.polarisTokenUri} />
          <Field label="Default namespace" value="analytics" />
          <Field label="Warehouse location" value={`s3://${endpoints.s3Bucket}/${warehouse}`} />
          <Field label="S3 Endpoint" value={endpoints.s3Endpoint} />
          <Field label="S3 Key ID / Access Key" value={s3Keys ? (showS3Keys ? s3Keys.accessKeyId : "•••••••• (afficher ci-dessus)") : "<absentes>"} />
          <Field label="S3 Secret Access Key" value={s3Keys ? (showS3Keys ? s3Keys.secretAccessKey : "••••••••") : "<absentes>"} />
        </div>
      </Section>

      {appUsers.length === 0 ? (
        <CharbonPanel className="text-center">
          <h2 className="font-display text-xl">Commencez par un compte applicatif</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-blanc/70">
            Chaque outil reçoit ses propres credentials, limitées aux droits
            de son rôle — le compte root ne quitte jamais le serveur.
          </p>
          <Button asChild className="mt-5 rounded-full bg-jaune font-semibold text-charbon hover:bg-jaune/90">
            <a href="/admin/users">
              <ExternalLink className="h-4 w-4" strokeWidth={1.6} /> Créer un utilisateur applicatif
            </a>
          </Button>
        </CharbonPanel>
      ) : null}
    </div>
  );
}
