# Ollama — ParusDB

Ollama est le serveur d'inférence LLM local de la brique Chat IA
(AGENTS.md §11) : il sert les modèles open source (Gemma, Mistral, Qwen…) sur
le GPU NVIDIA de la machine hôte. Il ne connaît ni Trino, ni le lakehouse,
ni aucun secret : les modèles n'accèdent aux données que par les outils MCP
exposés par [mcp-trino](../mcp-trino).

## Architecture

| Brique | Choix |
|---|---|
| Image | `ollama/ollama:0.40.6` |
| GPU | réservation `driver: nvidia` (NVIDIA Container Toolkit requis sur l'hôte) |
| Modèles | stockés dans `volumes/ollama/` (bind mount, plusieurs Go par modèle) |
| Réseau | aucun réseau partagé : l'API est publiée sur le port hôte `OLLAMA_PORT` |
| Modèle par défaut | `gemma4:e2b` — 2.3B paramètres effectifs, function calling natif (tools MCP), ~4.6 Go, tient dans les 6 Go de VRAM d'une RTX 3050 laptop |

## Prérequis GPU (une seule fois)

Le conteneur accède au GPU via le runtime Docker `nvidia`
(https://docs.ollama.com/docker) :

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
    | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
    | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker   # redémarre aussi les autres conteneurs
```

`sh setup.sh` vérifie ce prérequis et affiche cette procédure en cas d'absence.

## Cycle de vie

Identique à `apps/supabase` :

```bash
sh setup.sh   # .env, démarrage, pull des modèles, test de génération
sh run.sh start | stop | restart | status | logs   # cycle de vie
sh run.sh cli        # chat interactif avec OLLAMA_DEFAULT_MODEL
sh run.sh list       # modèles installés
sh run.sh gpu        # GPU vu par le conteneur + modèles chargés
sh run.sh test       # test e2e Chat IA (requiert apps/mcp-trino)
sh update.sh  # pull de l'image + recréation + mise à jour des modèles
sh reset.sh   # tout réinitialiser (conteneurs + modèles + .env)
```

## Points d'entrée

- API HTTP : `http://localhost:11434` (`/api/chat` avec `tools` pour le
  function calling MCP)
- Chat interactif : `sh run.sh cli`
- Test e2e Chat IA : `sh run.sh test` — pose la question
  « Quel est mon chiffre d'affaire sur 3 mois ? » au modèle, qui explore le
  lakehouse et exécute son SQL via mcp-trino, puis restitue la réponse.
  Le script (`scripts/test-mcp-trino.mjs`, Node >= 18 sans dépendance) crée
  les données de test `dev.sales.orders` et vérifie le montant attendu.

## Notes opérationnelles

- Version épinglée dans `docker-compose.yml` : mettre à jour = changer le
  tag puis `sh update.sh`. Gemma 4 requiert une version récente d'Ollama.
- Sans NVIDIA Container Toolkit, `docker compose up` échoue avec
  « could not select device driver "nvidia" » : suivre le prérequis GPU.
- `sh reset.sh` supprime les modèles téléchargés (plusieurs Go à
  re-télécharger ensuite). Ce script est le seul de l'app à ne pas avoir été
  validé par exécution : le vérifier au premier usage.
- **L'application (apps/nextjs) consomme `/api/chat` avec `tools`**
  (function calling, `lib/ollama.ts`) et `/api/tags` pour la liste des
  modèles proposés à la création d'agents ; la boucle agentique
  (`lib/agent-runner.ts`) plafonne les allers-retours Ollama ↔ mcp-trino à
  `PARUSDB_AGENT_MAX_STEPS` (8 par défaut) et le titre de conversation est
  généré par une seconde requête au même modèle.
- **Le LLM est non déterministe** : `gemma4:e2b` peut échouer sur une syntaxe
  Trino invalide d'une exécution à l'autre. Le prompt socle de l'app documente
  la syntaxe des dates relatives Trino (`date_add('month', -3, current_date)`)
  et impose de corriger et rejouer en cas d'erreur SQL — toujours rejouer un
  test e2e avant de conclure à un succès ou un échec.
