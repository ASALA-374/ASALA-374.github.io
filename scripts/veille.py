#!/usr/bin/env python3
"""
Veille technologique automatique : portfolio BTS SIO (option SISR).

Sources (toutes officielles et librement réutilisables, republiées en entier) :
  - CERT-FR (ANSSI, France) : API publique /avis/json/, /alerte/json/,
    contenus sous Licence Ouverte 2.0 (Etalab) ;
  - CISA (agence américaine de cybersécurité) : catalogue KEV des failles
    activement exploitées + avis de sécurité. Œuvres du gouvernement
    américain : domaine public (CC0 hors des États-Unis).

À chaque exécution, le script :
  1. récupère les bulletins publiés depuis le 1er octobre 2026 (rattrapage
     automatique des jours manquants) ;
  2. pour chaque jour, attribue un score d'importance à chaque bulletin
     (alerte > avis, exécution de code à distance, exploitation active,
     équipements réseau, nombre de CVE...) ;
  3. garde LE bulletin le plus important du jour, avec son contenu complet,
     dans data/veille.json (lu par le site, aucun lien externe).

Aucune dépendance : bibliothèque standard Python 3.9+.
Usage : python scripts/veille.py
"""
from __future__ import annotations

import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "data" / "veille.json"
PARIS = ZoneInfo("Europe/Paris")
START = date(2026, 10, 1)                 # début de l'historique de veille
BASES = ["https://www.cert.cyber.gouv.fr", "https://cert.cyber.gouv.fr"]
MAX_DETAILS = 900                         # garde-fou sur le nombre de requêtes
UA = "Mozilla/5.0 (compatible; VeillePortfolioBTS/2.0)"
LOG: list[str] = []


def log(msg: str) -> None:
    print(msg)
    LOG.append(msg)


# ---------------------------------------------------------------------------
# Accès à l'API CERT-FR
# ---------------------------------------------------------------------------
def get_json(path_or_url: str):
    urls = [path_or_url] if path_or_url.startswith("http") else [b + path_or_url for b in BASES]
    last = None
    for url in urls:
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    return json.loads(r.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                last = e
                if e.code == 404:
                    break                     # inutile de réessayer
                time.sleep(1 + attempt)
            except Exception as e:            # réseau, JSON invalide...
                last = e
                time.sleep(1 + attempt)
    raise RuntimeError(f"{path_or_url}: {last}")


def as_list(payload) -> list:
    """L'API renvoie une liste ; on accepte aussi {"results": [...]} par sécurité."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for k in ("results", "items", "data"):
            if isinstance(payload.get(k), list):
                return payload[k]
    return []


DATE_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
MOIS = {m: i + 1 for i, m in enumerate(["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
                                        "août", "septembre", "octobre", "novembre", "décembre"])}


def to_date(value) -> date | None:
    if not value:
        return None
    s = str(value)
    m = DATE_RE.search(s)
    if m:
        try:
            # format ISO avec fuseau : convertir en heure de Paris
            if "T" in s:
                dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
                if dt.tzinfo:
                    return dt.astimezone(PARIS).date()
            return date(int(m[1]), int(m[2]), int(m[3]))
        except ValueError:
            return date(int(m[1]), int(m[2]), int(m[3]))
    m = re.search(r"(\d{1,2})\s+([a-zéû]+)\s+(\d{4})", s.lower())
    if m and m[2] in MOIS:
        return date(int(m[3]), MOIS[m[2]], int(m[1]))
    return None


# ---------------------------------------------------------------------------
# Nettoyage du contenu : HTML ou Markdown -> blocs simples (titre, paragraphe, liste)
# Les liens sont convertis en texte : rien ne s'ouvre hors du site.
# ---------------------------------------------------------------------------
class _Blocks(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks, self.buf, self.kind = [], [], "p"

    def flush(self):
        text = re.sub(r"\s+", " ", "".join(self.buf)).strip()
        if text and not re.fullmatch(r"https?://\S+", text):
            self.blocks.append({"t": self.kind, "x": text})
        self.buf, self.kind = [], "p"

    def handle_starttag(self, tag, attrs):
        if tag in ("p", "div", "ul", "ol", "table", "tr", "pre"):
            self.flush()
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.flush(); self.kind = "h"
        elif tag == "li":
            self.flush(); self.kind = "li"
        elif tag == "br":
            self.buf.append(" ")

    def handle_endtag(self, tag):
        if tag in ("p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "pre"):
            self.flush()

    def handle_data(self, data):
        self.buf.append(data)


def to_blocks(text: str | None) -> list[dict]:
    if not text:
        return []
    if re.search(r"<(p|br|li|ul|ol|h\d|div|table)\b", text, re.I):          # HTML structuré
        parser = _Blocks()
        parser.feed(text); parser.flush()
        return parser.blocks
    # Markdown / texte brut
    blocks, para = [], []

    def push_para():
        if para:
            blocks.append({"t": "p", "x": " ".join(para)})
            para.clear()

    for raw in html.unescape(text).splitlines():
        line = raw.strip()
        line = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", line)        # [texte](lien) -> texte
        line = re.sub(r"<[^>]+>", "", line)                         # balises isolées (<code>...)
        line = re.sub(r"[*_`]{1,3}", "", line)
        if not line:
            push_para(); continue
        if re.fullmatch(r"<?https?://\S+>?", line):
            continue
        if line.startswith("#"):
            push_para(); blocks.append({"t": "h", "x": line.lstrip("# ").strip()})
        elif re.match(r"^[-•]\s+|^\d+[.)]\s+", line):
            push_para(); blocks.append({"t": "li", "x": re.sub(r"^[-•]\s+|^\d+[.)]\s+", "", line)})
        else:
            para.append(line)
    push_para()
    return blocks


def short(text: str | None, n: int = 320) -> str:
    """Premier paragraphe du résumé, pour les cartes de la liste."""
    blocks = [b["x"] for b in to_blocks(text) if b["t"] != "h"]
    first = blocks[0] if blocks else ""
    return first if len(first) <= n else first[:n].rsplit(" ", 1)[0].rstrip(" .,;:") + "…"


def plain(text: str | None) -> str:
    return " ".join(b["x"] for b in to_blocks(text)).strip()


# ---------------------------------------------------------------------------
# Score d'importance d'un bulletin
# ---------------------------------------------------------------------------
KEYWORDS = [
    (r"activement exploit|exploitée|exploitation active|exploited|zero[- ]?day|0[- ]?day", 10, "Sécurité"),
    (r"exécution de code arbitraire à distance|exécution de code à distance|remote code", 8, "Sécurité"),
    (r"élévation de privil", 4, "Sécurité"),
    (r"contournement de (la )?politique de sécurité|contournement de l'authentification", 4, "Sécurité"),
    (r"atteinte à la confidentialité|fuite|divulgation", 2, "Sécurité"),
    (r"déni de service", 2, "Sécurité"),
    (r"rançongiciel|ransomware", 6, "Sécurité"),
    (r"\bCisco\b|Fortinet|FortiOS|FortiGate|Palo Alto|PAN-OS|Juniper|Ivanti|SonicWall|Check Point|\bF5\b|Citrix|NetScaler|MikroTik|Ubiquiti|Stormshield|Aruba|Zyxel", 6, "Réseau"),
    (r"\bVPN\b|pare-feu|firewall|routeur|commutateur|switch|\bDNS\b|\bDHCP\b|Wi-?Fi|\bSSH\b|\bTLS\b|OpenSSL|OpenSSH", 4, "Réseau"),
    (r"Microsoft|Windows|Active Directory|Exchange|Entra|Intune|Office|Outlook", 4, "Système"),
    (r"VMware|ESXi|vCenter|Hyper-V|Proxmox|Citrix", 4, "Système"),
    (r"\bLinux\b|noyau|kernel|Debian|Ubuntu|Red Hat|SUSE", 3, "Système"),
    (r"Apple|iOS|iPadOS|macOS|Android|Samsung|Google Chrome|Mozilla|Firefox", 2, "Système"),
    (r"\bPHP\b|Apache|nginx|Tomcat|WordPress|Drupal|GitLab|Jenkins", 2, "Système"),
]
COMPILED = [(re.compile(p, re.I), pts, theme) for p, pts, theme in KEYWORDS]


def score(item: dict) -> tuple[int, list[str]]:
    text = " ".join([item["title"], item["title"], " ".join(b["x"] for b in item.get("intro", [])), " ".join(item["risks"]),
                     " ".join(item["systems"]), " ".join(b["x"] for b in item["blocks"][:12])])
    pts, themes = 0, {}
    for rx, p, theme in COMPILED:
        if rx.search(text):
            pts += p
            themes[theme] = themes.get(theme, 0) + p
    pts += 30 if item["kind"] == "Alerte" else 0
    pts += 18 if item["kind"] == "Catalogue KEV" else 0
    pts += 6 if any("rançongiciel" in r for r in item["risks"]) else 0
    pts += min(len(item["cves"]), 6)
    tags = [t for t, _ in sorted(themes.items(), key=lambda kv: -kv[1])][:3] or ["Sécurité"]
    if item["kind"] == "Alerte" and "Sécurité" not in tags:
        tags.insert(0, "Sécurité")
    return pts, tags


def normalize(kind: str, d: dict) -> dict | None:
    revs = d.get("revisions") or []
    dates = [to_date(r.get("revision_date")) for r in revs if isinstance(r, dict)]
    dates = [x for x in dates if x]
    pub = min(dates) if dates else to_date(d.get("last_revision_date"))
    if not pub or not d.get("title"):
        return None
    systems = []
    for s in d.get("affected_systems") or []:
        if isinstance(s, dict):
            desc = plain(s.get("description"))
            prod = (s.get("product") or {}).get("name") if isinstance(s.get("product"), dict) else None
            systems.append(desc or prod or "")
    if not systems and d.get("affected_systems_content"):
        systems = [b["x"] for b in to_blocks(d.get("affected_systems_content"))]
    return {
        "date": pub.isoformat(),
        "ref": d.get("reference", ""),
        "kind": kind,
        "title": plain(d.get("title")),
        "summary": short(d.get("summary")),
        "intro": to_blocks(d.get("summary"))[:30],
        "risks": [plain(r.get("description")) for r in (d.get("risks") or []) if isinstance(r, dict) and r.get("description")],
        "systems": [s for s in systems if s][:25],
        "blocks": to_blocks(d.get("content"))[:60],
        "cves": [c.get("name") for c in (d.get("cves") or []) if isinstance(c, dict) and c.get("name")][:40],
        "revisions": [{"date": (to_date(r.get("revision_date")) or pub).isoformat(), "x": plain(r.get("description"))}
                      for r in revs if isinstance(r, dict)][:10],
        "source": "CERT-FR",
        "lang": "fr",
        "credit": f"CERT-FR (ANSSI), bulletin {d.get('reference', '')}. Contenu réutilisé sous Licence Ouverte 2.0 (Etalab).",
    }


# ---------------------------------------------------------------------------
# Programme principal
# ---------------------------------------------------------------------------
def load_data() -> dict:
    if DATA_FILE.exists():
        try:
            return json.loads(DATA_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {}


def main() -> int:
    now = datetime.now(timezone.utc)
    today = now.astimezone(PARIS).date()
    data = load_data()
    # on ne garde que les entrées CERT-FR complètes (migration de l'ancien format)
    entries = [e for e in data.get("entries", []) if e.get("ref") and e.get("intro") is not None]
    have = {e["date"] for e in entries if e.get("source", "CERT-FR") == "CERT-FR"}
    checked = to_date(data.get("checked_until")) or (START - timedelta(days=1))
    if "--full" in sys.argv:
        checked, entries, have = START - timedelta(days=1), [], set()
    frm = max(START, checked + timedelta(days=1))
    log(f"Période analysée : {frm} → {today}")

    # 1) listes des bulletins
    listing = []
    for kind, path in (("Alerte", "/alerte/json/"), ("Avis", "/avis/json/")):
        try:
            items = as_list(get_json(path))
            log(f"{kind} : {len(items)} bulletins listés")
            listing += [(kind, it) for it in items if isinstance(it, dict)]
        except Exception as e:
            log(f"ERREUR liste {kind} : {e}")
    if not listing:
        log("CERT-FR indisponible : on passe aux autres sources.")
        kev(entries, today); cisa_advisories(entries, today)
        save(data, entries, checked, now)
        return 0

    # 2) détails des bulletins susceptibles d'être publiés dans la période
    def detail(kind, it):
        ref = it.get("reference")
        url = it.get("json_url") if isinstance(it.get("json_url"), str) and it.get("json_url") else \
            f"/{'alerte' if kind == 'Alerte' else 'avis'}/{ref}/json/"
        if url.startswith("/") is False and not url.startswith("http"):
            url = "/" + url
        return normalize(kind, get_json(url))

    found, fetched, seen = [], 0, set()
    for kind, it in listing:
        lr = to_date(it.get("last_revision_date"))
        if lr and lr < frm:
            continue
        if fetched >= MAX_DETAILS:
            break
        try:
            n = detail(kind, it); fetched += 1
            if n:
                seen.add(n["ref"])
                if frm <= date.fromisoformat(n["date"]) <= today:
                    found.append(n)
        except Exception as e:
            log(f"ERREUR détail {it.get('reference')} : {e}")
        time.sleep(.12)

    # 3) rattrapage : si la liste ne remonte pas assez loin, on parcourt les références d'avis
    refs = [it.get("reference", "") for k, it in listing if k == "Avis"]
    nums = sorted(int(m[2]) for r in refs if (m := re.match(r"CERTFR-(\d{4})-AVI-(\d+)", r or "")) and int(m[1]) == today.year)
    oldest = min((date.fromisoformat(f["date"]) for f in found if f["kind"] == "Avis"), default=today)
    if nums and oldest > frm:
        n, misses = nums[0] - 1, 0
        log(f"Rattrapage à partir de CERTFR-{today.year}-AVI-{n}")
        while n > 0 and fetched < MAX_DETAILS and misses < 8:
            ref = f"CERTFR-{today.year}-AVI-{n}"
            try:
                d = normalize("Avis", get_json(f"/avis/{ref}/json/")); fetched += 1; misses = 0
                if d:
                    dd = date.fromisoformat(d["date"])
                    if dd < frm:
                        break
                    if dd <= today and d["ref"] not in seen:
                        found.append(d)
            except Exception:
                misses += 1
            n -= 1
            time.sleep(.12)
    log(f"{fetched} bulletins détaillés, {len(found)} dans la période")

    # 4) le bulletin le plus important de chaque jour
    by_day: dict[str, list] = {}
    for f in found:
        by_day.setdefault(f["date"], []).append(f)
    added = 0
    for day in sorted(by_day):
        if day in have:
            continue
        ranked = []
        for f in by_day[day]:
            s, tags = score(f)
            ranked.append((s, f, tags))
        ranked.sort(key=lambda r: (r[0], r[1]["ref"]), reverse=True)
        s, best, tags = ranked[0]
        entries.append({**best, "tags": tags, "score": s, "candidates": len(ranked)})
        added += 1
        log(f"  {day} [{s:>3}] {best['ref']} {best['title'][:80]}")
    log(f"CERT-FR : {added} jour(s) ajouté(s)")

    kev(entries, today)
    cisa_advisories(entries, today)

    # jusqu'à hier, la période est considérée comme traitée (aujourd'hui peut encore évoluer)
    save(data, entries, max(checked, today - timedelta(days=1)), now)
    return 0


def save(data: dict, entries: list, checked: date, now: datetime) -> None:
    data = {
        "updated": now.isoformat(timespec="seconds"),
        "source": "CERT-FR (ANSSI), contenus réutilisés sous Licence Ouverte 2.0 (Etalab)",
        "start": START.isoformat(),
        "checked_until": checked.isoformat(),
        "log": LOG[-60:],
        "entries": sorted(entries, key=lambda e: (e["date"], e.get("score", 0)), reverse=True)[:600],
    }
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# CISA (États-Unis) : catalogue KEV et avis de sécurité
# ---------------------------------------------------------------------------
KEV_URLS = ["https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
            "https://raw.githubusercontent.com/cisagov/kev-data/main/known_exploited_vulnerabilities.json"]
CISA_RSS = "https://www.cisa.gov/cybersecurity-advisories/all.xml"
CISA_CREDIT = ("CISA (Cybersecurity and Infrastructure Security Agency, États-Unis). "
               "Œuvre du gouvernement américain, domaine public.")


def get_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                                               "(KHTML, like Gecko) Chrome/124 Safari/537.36",
                                               "Accept": "text/html,application/xml,application/rss+xml,*/*"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def fr_date(iso: str) -> str:
    try:
        d = date.fromisoformat(iso)
    except ValueError:
        return iso
    mois = list(MOIS)[d.month - 1]
    return f"{d.day} {mois} {d.year}"


def kev(entries: list, today: date) -> None:
    payload = None
    for url in KEV_URLS:
        try:
            payload = get_json(url); break
        except Exception as e:
            log(f"KEV indisponible via {url[:40]}… : {e}")
    vulns = (payload or {}).get("vulnerabilities") if isinstance(payload, dict) else None
    if not vulns:
        return
    by_day: dict[str, list] = {}
    for v in vulns:
        d = to_date(v.get("dateAdded"))
        if d and START <= d <= today:
            by_day.setdefault(d.isoformat(), []).append(v)
    existing = {e["date"]: i for i, e in enumerate(entries) if e.get("source") == "CISA" and e.get("kind") == "Catalogue KEV"}
    recent = (today - timedelta(days=2)).isoformat()
    added = 0
    for day, vs in sorted(by_day.items()):
        if day in existing and day < recent:
            continue                                   # déjà traité (les 2 derniers jours sont recalculés)
        vs.sort(key=lambda v: (v.get("vendorProject", ""), v.get("cveID", "")))
        names = [f"{v.get('vendorProject', '')} {v.get('product', '')}".strip() for v in vs]
        vendors = list(dict.fromkeys(v.get("vendorProject", "") for v in vs))
        ransom = any(str(v.get("knownRansomwareCampaignUse", "")).lower() == "known" for v in vs)
        n = len(vs)
        title = (f"Faille activement exploitée dans {names[0]}" if n == 1 else
                 f"{n} failles activement exploitées : {', '.join(vendors[:3])}{'…' if len(vendors) > 3 else ''}")
        intro = [{"t": "p", "x": "Le catalogue KEV (Known Exploited Vulnerabilities) de la CISA recense les vulnérabilités "
                                 "dont l'exploitation par des attaquants est confirmée. Les agences fédérales américaines "
                                 "doivent les corriger avant la date limite indiquée ; c'est une référence mondiale pour "
                                 "prioriser les correctifs."}]
        for v in vs:
            intro.append({"t": "h", "x": f"{v.get('cveID', '')} : {v.get('vendorProject', '')} {v.get('product', '')}"})
            if v.get("vulnerabilityName"):
                intro.append({"t": "p", "x": v["vulnerabilityName"], "l": "en"})
            if v.get("shortDescription"):
                intro.append({"t": "p", "x": v["shortDescription"], "l": "en"})
            if v.get("requiredAction"):
                intro.append({"t": "li", "x": f"Action requise : {v['requiredAction']}"})
            if v.get("dueDate"):
                intro.append({"t": "li", "x": f"Date limite de correction (agences fédérales américaines) : {fr_date(v['dueDate'])}"})
            camp = str(v.get("knownRansomwareCampaignUse", "")).lower() == "known"
            intro.append({"t": "li", "x": f"Utilisée dans des campagnes de rançongiciel : {'oui' if camp else 'non connue à ce jour'}"})
        item = {
            "date": day, "ref": f"KEV-{day}", "kind": "Catalogue KEV", "source": "CISA", "lang": "en",
            "title": title,
            "summary": f"La CISA a ajouté {n} vulnérabilité{'s' if n > 1 else ''} activement exploitée{'s' if n > 1 else ''} "
                       f"à son catalogue KEV : " + " ; ".join(f"{nm} ({v.get('cveID', '')})" for nm, v in zip(names, vs))[:260] + ".",
            "intro": intro, "blocks": [],
            "risks": ["Exploitation active confirmée"] + (["Utilisée par des rançongiciels"] if ransom else []),
            "systems": list(dict.fromkeys(names))[:25],
            "cves": [v.get("cveID", "") for v in vs][:40],
            "revisions": [], "credit": CISA_CREDIT + " Catalogue Known Exploited Vulnerabilities.",
        }
        sc, tags = score(item)
        item.update(score=sc, tags=tags, candidates=n)
        if day in existing:
            entries[existing[day]] = item
        else:
            entries.append(item); added += 1
    log(f"CISA KEV : {added} jour(s) ajouté(s), {len(by_day)} jours avec des ajouts depuis le {START}")


def page_blocks(url: str) -> list[dict]:
    """Texte principal d'une page d'avis CISA (entre le titre et la fin du contenu)."""
    raw = get_text(url)
    m = re.search(r"<main\b.*?</main>", raw, re.S | re.I)
    body = m.group(0) if m else raw
    body = re.sub(r"<(script|style|nav|header|footer|form|aside)\b.*?</\1>", " ", body, flags=re.S | re.I)
    h1 = re.search(r"<h1\b.*?</h1>", body, re.S | re.I)
    if h1:
        body = body[h1.end():]
    cut = re.search(r"This product is provided subject to|Terms of Use|Please share your thoughts", body, re.I)
    if cut:
        body = body[:cut.start()]
    blocks = [b for b in to_blocks(body) if len(b["x"]) > 2 and not re.fullmatch(r"(Share|Print|Related Topics?|Return to top)[: ]*", b["x"], re.I)]
    for b in blocks:
        b["l"] = "en"
    return blocks[:90]


def cisa_advisories(entries: list, today: date) -> None:
    try:
        root = ET.fromstring(get_text(CISA_RSS).encode("utf-8"))
    except Exception as e:
        log(f"Avis CISA indisponibles : {e}")
        return
    dup = re.compile(r"Known Exploited Vulnerabilit", re.I)        # annonces KEV : déjà couvertes par le catalogue
    entries[:] = [e for e in entries if not (e.get("source") == "CISA" and e.get("kind") != "Catalogue KEV" and dup.search(e.get("title", "")))]
    have = {e["date"] for e in entries if e.get("source") == "CISA" and e.get("kind") != "Catalogue KEV"}
    by_day: dict[str, list] = {}
    for it in root.iter("item"):
        link = (it.findtext("link") or "").strip()
        title = plain(it.findtext("title"))
        try:
            pub = parsedate_to_datetime(it.findtext("pubDate") or "").astimezone(PARIS).date()
        except Exception:
            pub = to_date(it.findtext("pubDate"))
        if not (link and title and pub and START <= pub <= today) or pub.isoformat() in have or dup.search(title):
            continue
        kind = "Avis ICS" if "ics" in link.lower() else "Alerte CISA" if "/alerts/" in link else "Avis CISA"
        desc = it.findtext("description") or ""
        item = {"date": pub.isoformat(), "ref": link.rstrip("/").rsplit("/", 1)[-1].upper()[:40], "kind": kind,
                "source": "CISA", "lang": "en", "title": title, "summary": short(desc), "intro": [],
                "blocks": [dict(b, l="en") for b in to_blocks(desc)][:60], "risks": [], "systems": [], "cves": [],
                "revisions": [], "credit": CISA_CREDIT, "_link": link}
        sc, tags = score(item)
        by_day.setdefault(item["date"], []).append((sc, item, tags))
    added = 0
    for day, ranked in sorted(by_day.items()):
        ranked.sort(key=lambda r: r[0], reverse=True)
        best = None
        for _, item, _ in ranked[:3]:                  # on lit en entier les 3 meilleurs candidats du jour
            link = item.pop("_link")
            try:
                full = page_blocks(link)
                if sum(len(b["x"]) for b in full) > sum(len(b["x"]) for b in item["blocks"]):
                    item["blocks"] = full
            except Exception as e:
                log(f"Page CISA illisible ({item['ref']}) : {e}")
            sc, tags = score(item)
            if best is None or sc > best[0]:
                best = (sc, item, tags)
        sc, item, tags = best
        if sc < (16 if item["kind"] == "Avis ICS" else 10):
            continue                                   # trop éloigné des sujets réseau / systèmes
        text = " ".join(b["x"] for b in item["blocks"])
        item["cves"] = sorted(set(re.findall(r"CVE-\d{4}-\d{4,}", text)))[:40]
        if not item["summary"] or len(item["summary"]) < 60:
            item["summary"] = short(" ".join(b["x"] for b in item["blocks"] if b["t"] == "p")[:600]) or item["summary"]
        item.update(score=sc, tags=tags, candidates=len(ranked))
        entries.append(item); added += 1
    log(f"Avis CISA : {added} jour(s) ajouté(s)")


if __name__ == "__main__":
    sys.exit(main())
