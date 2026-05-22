# Based on stashapp-plugin-advanced-scene-ratings by shackofnoreturn
# Original: https://github.com/shackofnoreturn/stashapp-plugin-advanced-scene-ratings
# License: AGPL v3 - https://www.gnu.org/licenses/agpl-3.0.html

import sys
import json

try:
    import stashapi.log as log
    from stashapi.stashapp import StashInterface
except ModuleNotFoundError:
    import subprocess, importlib, site
    _installed = False
    for flags in [[], ["--break-system-packages"], ["--user"]]:
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "stashapp-tools", "--quiet", "--timeout", "5"] + flags)
            _installed = True
            break
        except subprocess.CalledProcessError:
            continue
    if _installed:
        importlib.invalidate_caches()
        user_site = site.getusersitepackages()
        if user_site not in sys.path:
            sys.path.insert(0, user_site)
    else:
        import os
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "vendor"))
    import stashapi.log as log
    from stashapi.stashapp import StashInterface

DEFAULT_GROUPS = [
    {"id": "physical",    "name": "Physical",    "weight": 1.0},
    {"id": "performance", "name": "Performance", "weight": 1.0},
]

DEFAULT_CRITERIA = [
    {"id": "face",       "name": "Face",              "group": "physical",    "weight": 1.0, "enabled": True, "legacy_key": "disable_face"},
    {"id": "breasts",    "name": "Breasts",           "group": "physical",    "weight": 1.0, "enabled": True, "legacy_key": "disable_breasts"},
    {"id": "ass",        "name": "Ass",               "group": "physical",    "weight": 1.0, "enabled": True, "legacy_key": "disable_ass"},
    {"id": "body",       "name": "Body Overall",      "group": "physical",    "weight": 1.0, "enabled": True, "legacy_key": "disable_body_overall"},
    {"id": "genitals",   "name": "Genitals",          "group": "physical",    "weight": 1.0, "enabled": True, "legacy_key": "disable_genitals"},
    {"id": "technique",  "name": "Technique",         "group": "performance", "weight": 1.0, "enabled": True, "legacy_key": "disable_technique"},
    {"id": "energy",     "name": "Energy & Presence", "group": "performance", "weight": 1.0, "enabled": True, "legacy_key": "disable_energy_presence"},
    {"id": "sluttiness", "name": "Sluttiness",        "group": "performance", "weight": 1.0, "enabled": True, "legacy_key": "disable_sluttiness"},
]

settings = {
    "custom_field_prefix": "",
}

MINIMUM_REQUIRED = 1


def main():
    log.info("RUNNING ...")
    global json_input, stash, criteria, groups
    json_input = read_stdin_json()
    stash = connect_to_stash(json_input)
    config = load_plugin_config(stash)
    update_settings_from_config(config)
    groups = load_groups()
    criteria = load_criteria(groups)
    log.debug(f"GROUPS: {[(g['id'], g['name'], g['weight']) for g in groups]}")
    log.debug(f"CRITERIA: {[(c['id'], c['name'], c['group'], c['weight'], c['enabled']) for c in criteria]}")
    handle_actions(json_input, stash)
    handle_hooks(json_input, stash)


def read_stdin_json():
    log.debug("READING INPUT ...")
    try:
        raw_input = sys.stdin.read()
        if not raw_input.strip():
            raise ValueError("No input received from stdin")
        return json.loads(raw_input)
    except json.JSONDecodeError as e:
        log.error(f"READ STDIN JSON: Failed to decode JSON: {e}")
    except ValueError as e:
        log.error(f"READ STDIN JSON: {e}")
    return {}


def connect_to_stash(json_input):
    log.debug("CONNECTING STASH INTERFACE ...")
    try:
        server_connection = json_input["server_connection"]
        return StashInterface(server_connection)
    except KeyError:
        log.error("STASH INTERFACE: Missing 'server_connection' in input.")
    except Exception as e:
        log.error(f"STASH INTERFACE: Failed to connect: {e}")
    return None


def load_plugin_config(stash):
    log.debug("LOADING PLUGIN CONFIGURATION ...")
    try:
        return stash.get_configuration().get("plugins", {})
    except Exception as e:
        log.error(f"PLUGIN CONFIGURATION: Failed to load: {e}")
        return {}


def update_settings_from_config(config):
    log.debug("UPDATING SETTINGS WITH CONFIG ...")
    try:
        if "advancedPerformerRating" in config:
            settings.update(config["advancedPerformerRating"])
    except Exception as e:
        log.error(f"PLUGIN CONFIGURATION: Failed to update settings: {e}")


def _coerce_bool(value, default=False):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    if isinstance(value, (int, float)):
        return value != 0
    return default


def _coerce_float(value, default=1.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def load_groups():
    raw_ids = settings.get("apr_group_ids")
    if not raw_ids or not isinstance(raw_ids, str):
        return [dict(g) for g in DEFAULT_GROUPS]
    ids = [s.strip() for s in raw_ids.split(",") if s.strip()]
    result = []
    for gid in ids:
        default = next((d for d in DEFAULT_GROUPS if d["id"] == gid), None)
        name = settings.get(f"apr_group_name_{gid}") or (default["name"] if default else gid.title())
        weight = _coerce_float(settings.get(f"apr_group_weight_{gid}"), default["weight"] if default else 1.0)
        result.append({"id": gid, "name": name, "weight": weight})
    return result or [dict(g) for g in DEFAULT_GROUPS]


def load_criteria(groups):
    valid_group_ids = {g["id"] for g in groups}
    fallback_group = groups[0]["id"] if groups else "physical"

    raw_ids = settings.get("apr_criteria_ids")
    if not raw_ids or not isinstance(raw_ids, str):
        return _criteria_from_legacy_defaults(valid_group_ids, fallback_group)

    ids = [s.strip() for s in raw_ids.split(",") if s.strip()]
    result = []
    for cid in ids:
        default = next((d for d in DEFAULT_CRITERIA if d["id"] == cid), None)
        name = settings.get(f"apr_name_{cid}") or (default["name"] if default else cid.title())
        group = settings.get(f"apr_group_{cid}") or (default["group"] if default else fallback_group)
        if group not in valid_group_ids:
            group = fallback_group
        weight = _coerce_float(settings.get(f"apr_weight_{cid}"), default["weight"] if default else 1.0)
        enabled = _coerce_bool(settings.get(f"apr_enabled_{cid}"), default["enabled"] if default else True)
        result.append({"id": cid, "name": name, "group": group, "weight": weight, "enabled": enabled})
    return result


def _criteria_from_legacy_defaults(valid_group_ids, fallback_group):
    out = []
    for d in DEFAULT_CRITERIA:
        legacy_disabled = _coerce_bool(settings.get(d["legacy_key"]), False)
        group = d["group"] if d["group"] in valid_group_ids else fallback_group
        out.append({
            "id": d["id"],
            "name": d["name"],
            "group": group,
            "weight": d["weight"],
            "enabled": d["enabled"] and not legacy_disabled,
        })
    return out


def cf_key(criterion):
    prefix = settings.get("custom_field_prefix", "")
    return f"{prefix}{criterion['name']}"


FIND_PERFORMERS_WITH_CF_GQL = """
query FindPerformersWithCF($page: Int!) {
  findPerformers(filter: { per_page: 100, page: $page }) {
    count
    performers { id name custom_fields }
  }
}
"""

UPDATE_PERFORMER_CF_GQL = """
mutation UpdatePerformerCF($id: ID!, $custom_fields: CustomFieldsInput!) {
  performerUpdate(input: { id: $id, custom_fields: $custom_fields }) { id }
}
"""


def fetch_performer_custom_fields(stash, performer_id):
    query = """
    query GetPerformerCF($id: ID!) {
      findPerformer(id: $id) { custom_fields }
    }
    """
    try:
        result = stash.call_GQL(query, {"id": performer_id})
        return (result.get("findPerformer") or {}).get("custom_fields") or {}
    except Exception as e:
        log.error(f"FETCH PERFORMER CUSTOM FIELDS: {e}")
        return {}


STAR_PRECISION_MAP = {"FULL": 20, "HALF": 10, "QUARTER": 5, "TENTH": 1}

def get_rating_precision():
    try:
        config = stash.get_configuration() or {}
        ui = config.get("ui") or {}
        rso = ui.get("ratingSystemOptions") or {}
        type_ = (rso.get("type") or "").upper()
        sp = (rso.get("starPrecision") or "").upper()
        if type_ == "DECIMAL":
            return 1
        return STAR_PRECISION_MAP.get(sp, 20)
    except Exception as e:
        log.warning(f"GET RATING PRECISION: Falling back to 20: {e}")
        return 20


def init_custom_fields():
    log.info("INITIALIZING CUSTOM FIELDS ...")
    enabled = [c for c in criteria if c["enabled"]]
    page, total = 1, 0
    while True:
        result = stash.call_GQL(FIND_PERFORMERS_WITH_CF_GQL, {"page": page})
        performers = (result.get("findPerformers") or {}).get("performers") or []
        if not performers:
            break
        for performer in performers:
            cf = performer.get("custom_fields") or {}
            missing = {cf_key(c): 0 for c in enabled if cf_key(c) not in cf}
            if not missing:
                continue
            try:
                stash.call_GQL(UPDATE_PERFORMER_CF_GQL, {
                    "id": performer["id"],
                    "custom_fields": {"partial": missing},
                })
                total += 1
                log.debug(f"INIT: Performer {performer['name']} — {list(missing.keys())}")
            except Exception as e:
                log.error(f"INIT: Performer {performer['name']} failed: {e}")
        page += 1
    log.info(f"INIT: {total} performers initialized")


def handle_actions(json_input, stash):
    log.debug("HANDLING ACTIONS ...")
    args = json_input.get("args", {})
    mode = args.get("mode")
    if mode == "process_performers":
        processPerformers(stash)
    elif mode == "init_custom_fields":
        init_custom_fields()


def handle_hooks(json_input, stash):
    if not stash:
        log.error("HANDLE HOOKS: No stash connection.")
        return
    try:
        args = json_input.get("args", {})
        hook = args.get("hookContext", {})
        if hook.get("type") == "Performer.Update.Post":
            performerID = hook.get("id") or hook.get("input", {}).get("id")
            if not performerID:
                log.error("HANDLE HOOKS: Missing performer ID in hook context.")
                return
            performer = stash.find_performer(performerID)
            if performer:
                calculate_rating(stash, performer)
            else:
                log.error(f"HANDLE HOOKS: Performer {performerID} not found.")
    except Exception as e:
        log.error(f"HANDLE HOOKS: Unexpected error: {e}")


def calculate_rating(stash, performer):
    enabled = [c for c in criteria if c["enabled"]]
    if not enabled:
        return

    hits_by_group = {g["id"]: [] for g in groups}
    custom_fields = fetch_performer_custom_fields(stash, performer["id"])

    for c in enabled:
        key = cf_key(c)
        val = custom_fields.get(key)
        if val is None:
            continue
        try:
            score = int(float(str(val)))
        except (ValueError, TypeError):
            continue
        if score == 0:
            continue
        bucket = hits_by_group.get(c["group"])
        if bucket is not None:
            bucket.append((score, float(c["weight"])))

    log.debug(f"SCORES: {hits_by_group}")
    total_hits = sum(len(h) for h in hits_by_group.values())
    if total_hits < MINIMUM_REQUIRED:
        return

    def weighted_avg(hits):
        total_w = sum(w for _, w in hits)
        if total_w <= 0:
            return None
        return sum(s * w for s, w in hits) / total_w

    group_contributions = []
    for g in groups:
        gavg = weighted_avg(hits_by_group.get(g["id"], []))
        if gavg is None:
            continue
        gw = float(g.get("weight", 1.0))
        if gw <= 0:
            continue
        group_contributions.append((gavg, gw))

    if not group_contributions:
        return

    total_gw = sum(w for _, w in group_contributions)
    final_avg = sum(a * w for a, w in group_contributions) / total_gw

    precision = max(1, get_rating_precision())
    final_rating100 = round(round(final_avg * 20 / precision) * precision)
    final_rating100 = max(precision, min(100, final_rating100))
    current_rating = performer.get("rating100") or 0

    log.debug(f"CURRENT: {current_rating}/100, AVERAGE: {final_avg:.2f}/5, NEW: {final_rating100}/100")

    if current_rating != final_rating100:
        try:
            stash.update_performer({"id": performer["id"], "rating100": final_rating100})
            log.info(f"Updating Performer {performer['name']} rating to {final_rating100}/100")
        except Exception as e:
            log.error(f"CALCULATE RATING: Failed to update performer {performer.get('id', '?')}: {e}")


def processPerformers(stash):
    log.info("PROCESSING ALL PERFORMERS")
    try:
        performers = stash.find_performers({}, get_count=False, fragment="id name rating100")
    except Exception as e:
        log.error(f"PROCESS PERFORMERS: Failed to fetch performers: {e}")
        return
    total = len(performers)
    log.info(f"PROCESS PERFORMERS: Found {total} performers")
    for p in performers:
        try:
            calculate_rating(stash, p)
        except Exception as e:
            log.error(f"PROCESS PERFORMERS: Failed on performer {p.get('id', '?')} ({p.get('name', '?')}): {e}")
    log.info(f"PROCESS PERFORMERS: Done ({total} processed)")


if __name__ == "__main__":
    main()
