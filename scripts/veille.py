#!/usr/bin/env python3
"""
Veille technologique automatique — portfolio BTS SIO SISR.

Chaque jour, ce script :
  1. lit les flux RSS/Atom de sources reconnues (CERT-FR, BleepingComputer, ...) ;
  2. garde les articles publiés dans les dernières 36 h ;
  3. attribue un score d'importance (source + mots-clés réseau / sécurité / CVE) ;
  4. ajoute LA news la plus importante du jour dans data/veille.json.

Aucune dépendance externe : uniquement la bibliothèque standard Python (3.9+).
Usage : python scripts/veille.py
"""
from __future__ import annotations

import html
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "data" / "veille.json"
PARIS = ZoneInfo("Europe/Paris")
MAX_HISTORY = 120          # nombre d'entrées conservées dans l'historique
WINDOW_HOURS = 36          # fenêtre de fraîcheur des articles
SUMMARY_LEN = 240          # longueur max du résumé affiché

# ---------------------------------------------------------------------------
# Sources : (nom affiché, URL du flux, poids de la source)
# Le poids favorise les sources institutionnelles et spécialisées.
# ---------------------------------------------------------------------------
FEEDS = [
    ("CERT-FR (alertes)",   "https://www.cert.ssi.gouv.fr/alerte/feed/",                     10),
    ("CERT-FR (actualités)", "https://www.cert.ssi.gouv.fr/actualite/feed/",                   6),
    ("CERT-FR (avis)",      "https://www.cert.ssi.gouv.fr/avis/feed/",                        3),
    ("BleepingComputer",    "https://www.bleepingcomputer.com/feed/",                          5),
    ("The Hacker News",     "https://feeds.feedburner.com/TheHackersNews",                     5),
    ("LeMagIT",             "https://www.lemagit.fr/rss/ContentSyndication.xml",               4),
    ("Le Monde Informatique", "https://www.lemondeinformatique.fr/flux-rss/thematique/toutes-les-actualites/rss.xml", 3),
    ("Next",                "https://next.ink/feed/",                                          3),
]

# ---------------------------------------------------------------------------
# Mots-clés : (regex, points, thème). Un même article cumule les points.
# ---------------------------------------------------------------------------
KEYWORDS = [
    # Gravité / urgence
    (r"\bz[eé]ro[- ]?day\b|\b0[- ]?day\b",                      9, "Sécurité"),
    (r"activement exploit|actively exploit|exploited in the wild|exploitée", 9, "Sécurité"),
    (r"\bcritique\b|\bcritical\b|cvss\s*(?:score\s*)?(?:of\s*)?(?:9|10)", 6, "Sécurité"),
    (r"\bCVE-\d{4}-\d{4,}\b",                                   5, "Sécurité"),
    (r"\bransomware\b|\brançongiciel",                          5, "Sécurité"),
    (r"\bfailles?\b|\bflaws?\b|vuln[eé]rabilit|\bvulnerab|\bRCE\b|ex[eé]cution de code|remote code", 4, "Sécurité"),
    (r"\bpatch\b|correctif|mise à jour de sécurité|security update", 2, "Sécurité"),
    (r"fuite de donn|data breach|cyberattaque|cyberattack|\bphishing\b|hameçonnage|botnet|\bDDoS\b", 3, "Sécurité"),
    # Réseau / infrastructure (cœur SISR)
    (r"\bCisco\b|\bFortinet\b|FortiGate|FortiOS|Palo Alto|PAN-OS|Juniper|\bIvanti\b|SonicWall|Check Point|\bF5\b|\bCitrix\b|NetScaler|MikroTik|Ubiquiti", 5, "Réseau"),
    (r"\bVPN\b|pare-feu|firewall|\brouteur|\brouter\b|switch|commutateur|\bBGP\b|\bDNS\b|\bDHCP\b|\bVLAN\b|\bSD-WAN\b|\bWi-?Fi\b|\bIPv6\b|\bTLS\b|\bSSH\b", 4, "Réseau"),
    (r"panne|outage|\bcoupure\b", 3, "Réseau"),
    # Systèmes / plateformes courantes
    (r"Windows Server|Active Directory|\bExchange\b|Microsoft|Patch Tuesday|\bLinux\b|\bkernel\b|\bnoyau\b|VMware|ESXi|Proxmox|Hyper-V|\bPHP\b|Apache|\bnginx\b|OpenSSL|OpenSSH|\bsudo\b", 3, "Système"),
    (r"\bcloud\b|\bAWS\b|\bAzure\b|Google Cloud|Kubernetes|\bDocker\b", 2, "Cloud"),
    (r"\bIA\b|intelligence artificielle|\bAI\b|\bLLM\b", 1, "IA"),
    # Institutions de référence
    (r"\bANSSI\b|\bCISA\b|CERT-FR|\bENISA\b|\bNIS ?2\b|\bRGPD\b|\bGDPR\b", 3, "Sécurité"),
]
COMPILED = [(re.compile(p, re.I), pts, theme) for p, pts, theme in KEYWORDS]
CVE_RE = re.compile(r"\bCVE-\d{4}-\d{4,}\b", re.I)
ATOM = "{http://www.w3.org/2005/Atom}"
UA = "Mozilla/5.0 (compatible; VeillePortfolioBot/1.0; +https://github.com/)"


# ---------------------------------------------------------------------------
# Lecture des flux
# ---------------------------------------------------------------------------
def fetch(url: str, timeout: int = 20) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def clean(text: str | None) -> str:
    """Supprime le HTML et normalise les espaces."""
    text = html.unescape(re.sub(r"<[^>]+>", " ", text or ""))
    return re.sub(r"\s+", " ", text).strip()


def parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    try:
        d = parsedate_to_datetime(value)            # format RSS (RFC 822)
    except (TypeError, ValueError, IndexError):
        try:
            d = datetime.fromisoformat(value.replace("Z", "+00:00"))  # format Atom (ISO 8601)
        except ValueError:
            return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def parse_feed(raw: bytes, source: str, weight: int) -> list[dict]:
    root = ET.fromstring(raw)
    items = []
    # RSS 2.0
    for it in root.iter("item"):
        items.append({
            "title": clean(it.findtext("title")),
            "link": (it.findtext("link") or "").strip(),
            "summary": clean(it.findtext("description")),
            "published": parse_date(it.findtext("pubDate") or it.findtext("{http://purl.org/dc/elements/1.1/}date")),
        })
    # Atom
    for en in root.iter(f"{ATOM}entry"):
        link = ""
        for l in en.findall(f"{ATOM}link"):
            if l.get("rel", "alternate") == "alternate":
                link = l.get("href", "")
                break
        items.append({
            "title": clean(en.findtext(f"{ATOM}title")),
            "link": link.strip(),
            "summary": clean(en.findtext(f"{ATOM}summary") or en.findtext(f"{ATOM}content")),
            "published": parse_date(en.findtext(f"{ATOM}published") or en.findtext(f"{ATOM}updated")),
        })
    for i in items:
        i["source"], i["weight"] = source, weight
    return [i for i in items if i["title"] and i["link"].startswith("http")]


# ---------------------------------------------------------------------------
# Score d'importance
# ---------------------------------------------------------------------------
def score(item: dict, now: datetime) -> tuple[int, list[str], list[str]]:
    text = f"{item['title']} {item['title']} {item['summary']}"   # le titre compte double
    pts, themes = 0, {}
    for rx, p, theme in COMPILED:
        if rx.search(text):
            pts += p
            themes[theme] = themes.get(theme, 0) + p
    if pts == 0:
        return 0, [], []                       # hors sujet réseau / sécu / IT
    cves = sorted({c.upper() for c in CVE_RE.findall(text)})
    age_h = (now - item["published"]).total_seconds() / 3600
    freshness = max(0, 6 - int(age_h // 6))    # bonus jusqu'à +6 pour les plus récents
    total = pts + item["weight"] + freshness + min(len(cves), 3)
    tags = [t for t, _ in sorted(themes.items(), key=lambda kv: -kv[1])][:3]
    return total, tags, cves


def norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()


def shorten(text: str, n: int = SUMMARY_LEN) -> str:
    if len(text) <= n:
        return text
    cut = text[:n].rsplit(" ", 1)[0]
    return cut.rstrip(" ,;:.-") + "…"


# ---------------------------------------------------------------------------
# Programme principal
# ---------------------------------------------------------------------------
def load_data() -> dict:
    if DATA_FILE.exists():
        try:
            return json.loads(DATA_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {"updated": None, "entries": []}


def pick_best(candidates: list[dict], history: list[dict], now: datetime) -> dict | None:
    seen_links = {e["link"] for e in history}
    seen_titles = {norm_title(e["title"]) for e in history}
    ranked = []
    for c in candidates:
        if not c["published"] or c["published"] > now + timedelta(hours=1):
            continue
        if now - c["published"] > timedelta(hours=WINDOW_HOURS):
            continue
        if c["link"] in seen_links or norm_title(c["title"]) in seen_titles:
            continue
        s, tags, cves = score(c, now)
        if s > 0:
            ranked.append((s, c, tags, cves))
    if not ranked:
        return None
    ranked.sort(key=lambda r: (r[0], r[1]["published"]), reverse=True)
    for s, c, tags, cves in ranked[:5]:
        print(f"  [{s:>3}] {c['source']:<22} {c['title'][:90]}")
    s, c, tags, cves = ranked[0]
    return {
        "title": c["title"],
        "summary": shorten(c["summary"]),
        "link": c["link"],
        "source": c["source"],
        "tags": tags,
        "cves": cves[:5],
        "score": s,
        "published": c["published"].astimezone(timezone.utc).isoformat(timespec="seconds"),
    }


def main() -> int:
    now = datetime.now(timezone.utc)
    today = now.astimezone(PARIS).date().isoformat()
    data = load_data()
    history = data.get("entries", [])

    if any(e.get("date") == today for e in history) and "--force" not in sys.argv:
        print(f"Une news existe déjà pour le {today} (utilise --force pour la remplacer).")
        return 0
    if "--force" in sys.argv:
        history = [e for e in history if e.get("date") != today]

    candidates = []
    for name, url, weight in FEEDS:
        try:
            got = parse_feed(fetch(url), name, weight)
            candidates += got
            print(f"✓ {name}: {len(got)} articles")
        except Exception as exc:                       # une source en panne ne bloque pas les autres
            print(f"✗ {name}: {exc}", file=sys.stderr)

    print(f"\nTop des candidats ({today}) :")
    best = pick_best(candidates, history, now)
    data["updated"] = now.isoformat(timespec="seconds")
    if best:
        best = {"date": today, **best}
        history.insert(0, best)
        print(f"\n→ News du jour : {best['title']} ({best['source']})")
    else:
        print("\nAucun article pertinent trouvé aujourd'hui : historique inchangé.")

    data["entries"] = sorted(history, key=lambda e: e["date"], reverse=True)[:MAX_HISTORY]
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
