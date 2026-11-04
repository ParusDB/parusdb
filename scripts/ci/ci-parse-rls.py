#!/usr/bin/env python3
"""CI : vérifie la sortie des tests RLS (apps/supabase/sql/tests/rls-rbac-test.sql).

Le fichier de tests émet des lignes de la forme

    T1a catalogues visibles (attendu 0)|0
    T2b read/write/manage (attendu t/f/f)|t|f|f

produites par `psql -A -t -F'|'` (une ligne par select de test, champs
séparés par `|`, premier champ = le libellé). Ce parseur extrait la valeur
attendue entre parenthèses (contenu après « attendu », tronqué au « : »
éventuel), la découpe sur « / » (une valeur par colonne de la ligne) et la
compare aux valeurs réelles. Toute divergence fait échouer la CI (exit 1).

Les lignes sans « (attendu ...) » ne portent pas d'assertion (journal
informative) : elles sont seulement comptées.
"""

import re
import sys

EXPECTED_RE = re.compile(r"\((attendu [^()]*)\)")


def parse_line(line: str) -> tuple[str, list[str], list[str]] | None:
    """Retourne (libellé, attendu, réel) ou None si pas d'assertion."""
    fields = line.rstrip("\n").split("|")
    if len(fields) < 2:
        return None
    label, actual = fields[0], fields[1:]
    match = EXPECTED_RE.search(label)
    if not match:
        return None
    # « attendu 1 : le message du membre a été refusé » -> « 1 »
    expected = match.group(1).removeprefix("attendu ").strip()
    expected = expected.split(":")[0].strip()
    return label, expected.split("/"), actual


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: ci-parse-rls.py <fichier-sortie-psql>", file=sys.stderr)
        return 2

    checked = 0
    failures: list[str] = []
    with open(sys.argv[1], encoding="utf-8") as fh:
        for line in fh:
            parsed = parse_line(line)
            if parsed is None:
                continue
            label, expected, actual = parsed
            checked += 1
            if [v.strip() for v in expected] != [v.strip() for v in actual]:
                failures.append(
                    f"{label} : attendu {expected}, obtenu {actual}"
                )

    print(f"Assertions RLS vérifiées : {checked}")
    if not checked:
        print("Aucune assertion trouvée : la sortie du test a-t-elle échoué ?",
              file=sys.stderr)
        return 1
    for failure in failures:
        print(f"ÉCHEC {failure}", file=sys.stderr)
    if failures:
        print(f"{len(failures)} assertion(s) RLS en échec", file=sys.stderr)
        return 1
    print("Toutes les assertions RLS sont conformes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
