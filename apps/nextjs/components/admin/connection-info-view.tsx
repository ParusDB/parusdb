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

// Informations de connexion du lakehouse pour les outils data externes
// (spec fonctionnelle § « Rôles et Permissions »). La page est **agnostique des outils** : elle
// décrit les protocoles d'accès (SQL, catalogue Iceberg REST, stockage
// objet S3) avec leurs paramètres factuels et un profil de connexion
// structuré par protocole - aucune section par outil (dbt, Power BI,
// Airbyte…), qui périmait à chaque évolution de la stack. Les secrets ne
// sont jamais stockés : ils apparaissent en marqueurs, affichés une seule
// fois à la création/réinitialisation du compte applicatif.

export interface AppUserConnection {
  id: string;
  name: string;
  clientId: string;
  roleKey: string;
  roleName: string;
  catalogs: string[];
}

const SECRET_PLACEHOLDER = "<votre client secret>";
const TRINO_PASSWORD_PLACEHOLDER = "<votre mot de passe SQL>";
const NO_ACCOUNT = "<créez un compte applicatif>";

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

  const warehouse = effectiveCatalog || "<catalogue>";

  // Identifiants du compte applicatif : le nom sert d'utilisateur SQL, le
  // clientId:secret de credential OAuth2. Les secrets sont en marqueurs.
  const sqlUser = selected?.name ?? NO_ACCOUNT;
  const clientId = selected?.clientId ?? NO_ACCOUNT;
  const scope = selected
    ? `PRINCIPAL_ROLE:${selected.roleKey}`
    : "PRINCIPAL_ROLE:<votre rôle>";

  // Profils de connexion par protocole : tout client compatible avec le
  // protocole se configure à partir de ces valeurs, quel que soit l'outil.
  const sqlProfile = `# Accès SQL - tout client compatible (protocole HTTPS, basic auth)
protocol: https
host: ${endpoints.trinoHost}
port: ${endpoints.trinoPort}
auth: basic
user: ${sqlUser}
password: ${TRINO_PASSWORD_PLACEHOLDER}
catalog: ${warehouse}`;

  const catalogProfile = `# Catalogue de tables (Iceberg REST) - client OAuth2
uri: ${endpoints.polarisRestUri}
oauth2_server_uri: ${endpoints.polarisTokenUri}
warehouse: ${warehouse}
credential: ${clientId}:${SECRET_PLACEHOLDER}
scope: ${scope}`;

  const s3Profile = `# Stockage de données (API S3)
endpoint: ${endpoints.s3Endpoint}
path_style: true
bucket: ${endpoints.s3Bucket}
region: ${endpoints.s3Region}
access_key_id: ${s3Keys ? (showS3Keys ? s3Keys.accessKeyId : "<afficher ci-dessous>") : "<absentes de la configuration serveur>"}
secret_access_key: ${s3Keys ? (showS3Keys ? s3Keys.secretAccessKey : "<afficher ci-dessous>") : "<absentes de la configuration serveur>"}`;

  return (
    <div className="space-y-6">
      {/* Avertissement sécurité */}
      <div className="flex items-start gap-3 rounded-2xl border border-jaune/40 bg-jaune/10 px-4 py-3">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-charbon" strokeWidth={1.8} />
        <p className="text-sm text-charbon">
          Ces adresses sont réservées au réseau privé (certificat autosigné
          côté SQL). Chaque compte applicatif reçoit des credentials dédiées,
          limitées aux droits de son rôle : un outil ne voit que les
          catalogues qui lui sont accordés.
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
                ? "Le rôle de ce compte n&apos;a accès à aucun catalogue : distribuez des droits via /admin/roles."
                : "-"}
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

      {/* Accès SQL */}
      <Section
        title="Accès SQL"
        description="Requêtage du lakehouse : tout client SQL capable de HTTPS + authentification par nom d'utilisateur et mot de passe (pilote du dialecte ci-dessous)."
      >
        <div>
          <Field label="Hôte" value={endpoints.trinoHost} />
          <Field label="Port" value={endpoints.trinoPort} />
          <Field label="Chiffrement" value="HTTPS (certificat autosigné : apps/trino/etc/keystore.crt)" />
          <Field label="Authentification" value="nom d'utilisateur + mot de passe" />
          <Field label="Utilisateur" value={sqlUser} />
          <Field label="Mot de passe" value={selected ? TRINO_PASSWORD_PLACEHOLDER : NO_ACCOUNT} />
          <Field label="Dialecte SQL" value="Trino" />
          <Field label="Catalogue par défaut" value={warehouse} />
        </div>
        <CodeBlock code={sqlProfile} />
      </Section>

      {/* Catalogue REST */}
      <Section
        title="Catalogue de tables (Iceberg REST)"
        description="Inventaire des bases, schémas et tables : tout client capable d'un flux OAuth2 client credentials (clientId + secret). Polaris vends des credentials de stockage temporaires aux clients compatibles - aucune clé statique à configurer."
      >
        <div>
          <Field label="URI du catalogue" value={endpoints.polarisRestUri} />
          <Field label="Jetons OAuth2" value={endpoints.polarisTokenUri} />
          <Field label="Credential" value={selected ? `${clientId}:${SECRET_PLACEHOLDER}` : NO_ACCOUNT} />
          <Field label="Scope" value={scope} />
          <Field label="Warehouse" value={warehouse} />
          <Field label="Délégation d'accès" value="vended-credentials (en-tête X-Iceberg-Access-Delegation)" />
        </div>
        <CodeBlock code={catalogProfile} />
      </Section>

      {/* Stockage objet */}
      <Section
        title="Stockage de données (API S3)"
        description="Fichiers de données sous-jacents. Nécessaire uniquement aux outils qui écrivent directement dans le stockage - les clients du catalogue REST reçoivent des credentials temporaires."
      >
        <div>
          <Field label="Endpoint" value={endpoints.s3Endpoint} />
          <Field label="Adressage" value="path-style" />
          <Field label="Bucket" value={endpoints.s3Bucket} />
          <Field label="Région" value={endpoints.s3Region} />
          <Field
            label="Clé d'accès"
            value={s3Keys ? (showS3Keys ? s3Keys.accessKeyId : "••••••••") : "<absentes de la configuration serveur>"}
          />
          <Field
            label="Clé secrète"
            value={s3Keys ? (showS3Keys ? s3Keys.secretAccessKey : "••••••••") : "<absentes de la configuration serveur>"}
          />
        </div>
        <div className="flex items-center gap-3">
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
                Révélation ponctuelle - les clients du catalogue REST n&apos;en
                ont pas besoin.
              </span>
            )
          ) : (
            <span className="text-xs text-muted-foreground">
              Clés absentes de la configuration serveur
              (S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY) : relancez le setup
              racine pour les importer.
            </span>
          )}
        </div>
        <CodeBlock code={s3Profile} />
      </Section>

      {/* Secrets : rappel */}
      <Section
        title="Secrets du compte applicatif"
        description="Le client secret et le mot de passe SQL ne sont jamais stockés ni réaffichés : ils apparaissent une seule fois, à la création ou à la réinitialisation des credentials."
      >
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm">
            <a href="/admin/users">
              <ExternalLink className="h-4 w-4" strokeWidth={1.6} /> Gérer les
              comptes applicatifs
            </a>
          </Button>
          <span className="text-xs text-muted-foreground">
            Utilisateurs → Applicatifs → « Réinitialiser les credentials »
            pour de nouveaux secrets.
          </span>
        </div>
      </Section>

      {appUsers.length === 0 ? (
        <CharbonPanel className="text-center">
          <h2 className="font-display text-xl">Commencez par un compte applicatif</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-blanc/70">
            Chaque outil reçoit ses propres credentials, limitées aux droits
            de son rôle - le compte root ne quitte jamais le serveur.
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
