// Based on stashapp-plugin-advanced-scene-ratings by shackofnoreturn
// Original: https://github.com/shackofnoreturn/stashapp-plugin-advanced-scene-ratings
// License: AGPL v3 - https://www.gnu.org/licenses/agpl-3.0.html

(function () {
    const PLUGIN_ID = "advancedPerformerRating";
    let pollTimer = null;

    /* ── Defaults & descriptions ─────────────────────────────────────── */
    const DEFAULT_GROUPS = [
        { id: "physical",    name: "Physical",    weight: 1 },
        { id: "performance", name: "Performance", weight: 1 },
    ];
    const DEFAULT_CRITERIA = [
        { id: "face",       name: "Face",              group: "physical",    weight: 1, enabled: true },
        { id: "breasts",    name: "Breasts",           group: "physical",    weight: 1, enabled: true },
        { id: "ass",        name: "Ass",               group: "physical",    weight: 1, enabled: true },
        { id: "body",       name: "Body Overall",      group: "physical",    weight: 1, enabled: true },
        { id: "genitals",   name: "Genitals",          group: "physical",    weight: 1, enabled: true },
        { id: "technique",  name: "Technique",         group: "performance", weight: 1, enabled: true },
        { id: "energy",     name: "Energy & Presence", group: "performance", weight: 1, enabled: true },
        { id: "sluttiness", name: "Sluttiness",        group: "performance", weight: 1, enabled: true },
    ];
    const LEGACY_DISABLE_KEYS = {
        face: "disable_face", breasts: "disable_breasts", ass: "disable_ass",
        body: "disable_body_overall", genitals: "disable_genitals",
        technique: "disable_technique", energy: "disable_energy_presence",
        sluttiness: "disable_sluttiness",
    };
    const DESCRIPTIONS = {
        face: "Facial attractiveness, eye appeal, lip shape, skin quality, and how good the face looks in close-ups, during oral, and while moaning or orgasming.",
        breasts: "Shape, size, firmness, symmetry, nipple appearance, and natural movement/jiggle during sex.",
        ass: "Shape, roundness, firmness, tightness, bounce, and visual appeal in doggy, cowgirl, and spanking shots.",
        body: "Proportions, waist-to-hip ratio, muscle tone, skin condition, legs, posture, and overall physical presence on camera.",
        genitals: "Visual appeal and presentation of the performer's sexual organs when aroused and groomed.",
        technique: "Technical ability and proficiency in sex: quality of oral, handjobs, riding rhythm, hip movement, depth control, muscle contractions, kissing, and overall sexual technique.",
        energy: "Visible enthusiasm, stamina, vocalization, authenticity and intensity of pleasure expressions, eye contact, orgasm quality, and how strongly the performer commands attention.",
        sluttiness: "Degree of uninhibitedness and sexual eagerness: willingness to embrace rough sex, anal, deepthroat, degradation, and extreme kinks, visible hunger and greed for cock/pussy, active begging or initiating sex, intensity of dirty talk, and overall attitude of shameless sexual availability.",
    };

    /* ── GraphQL ─────────────────────────────────────────────────────── */
    async function gqlClient(query, variables) {
        const res = await fetch('/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, variables })
        });
        return res.json();
    }

    async function getPluginConfig() {
        const query = `query Configuration { configuration { plugins } }`;
        const res = await gqlClient(query);
        try { return res.data.configuration.plugins[PLUGIN_ID] || {}; }
        catch (e) { return {}; }
    }

    const STAR_PRECISION_MAP = { FULL: 20, HALF: 10, QUARTER: 5, TENTH: 1 };
    const STAR_PRECISION_LABEL = { 20: "Full star", 10: "Half star", 5: "Quarter star", 1: "Tenth star" };

    async function getStashRatingInfo() {
        try {
            const res = await gqlClient(`{ configuration { ui } }`);
            const ui = (res.data && res.data.configuration && res.data.configuration.ui) || {};
            const rso = ui.ratingSystemOptions || {};
            const type = (rso.type || "").toUpperCase();
            const sp = (rso.starPrecision || "").toUpperCase();
            if (type === "DECIMAL") return { precision: 1, label: "Decimal (10-point)" };
            const precision = STAR_PRECISION_MAP[sp] || 20;
            return { precision, label: STAR_PRECISION_LABEL[precision] || ("Stars (" + precision + ")") };
        } catch (e) {
            return { precision: 20, label: "Full star (default)" };
        }
    }
    async function getStashRatingPrecision() { return (await getStashRatingInfo()).precision; }

    async function configurePlugin(input) {
        const mutation = `mutation ConfigurePlugin($plugin_id: ID!, $input: Map!) {
            configurePlugin(plugin_id: $plugin_id, input: $input)
        }`;
        return gqlClient(mutation, { plugin_id: PLUGIN_ID, input });
    }

    /* ── Criteria config helpers ─────────────────────────────────────── */
    function coerceBool(v, def) {
        if (typeof v === "boolean") return v;
        if (typeof v === "string") return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
        if (typeof v === "number") return v !== 0;
        return def;
    }
    function coerceFloat(v, def) {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : def;
    }

    function groupsFromConfig(config) {
        const raw = config.apr_group_ids;
        if (typeof raw === "string" && raw.trim()) {
            const ids = raw.split(",").map(s => s.trim()).filter(Boolean);
            const result = ids.map(id => {
                const def = DEFAULT_GROUPS.find(d => d.id === id);
                return {
                    id,
                    name: config[`apr_group_name_${id}`] || (def ? def.name : id),
                    weight: coerceFloat(config[`apr_group_weight_${id}`], def ? def.weight : 1),
                };
            });
            if (result.length) return result;
        }
        return DEFAULT_GROUPS.map(d => Object.assign({}, d));
    }

    function criteriaFromConfig(config, groups) {
        const validGroupIds = new Set(groups.map(g => g.id));
        const fallbackGroup = groups[0] ? groups[0].id : "physical";

        const raw = config.apr_criteria_ids;
        if (typeof raw === "string" && raw.trim()) {
            const ids = raw.split(",").map(s => s.trim()).filter(Boolean);
            return ids.map(id => {
                const def = DEFAULT_CRITERIA.find(d => d.id === id);
                const cfgGroup = config[`apr_group_${id}`];
                const group = validGroupIds.has(cfgGroup)
                    ? cfgGroup
                    : (def && validGroupIds.has(def.group) ? def.group : fallbackGroup);
                return {
                    id,
                    name: config[`apr_name_${id}`] || (def ? def.name : id),
                    group,
                    weight: coerceFloat(config[`apr_weight_${id}`], def ? def.weight : 1),
                    enabled: coerceBool(config[`apr_enabled_${id}`], def ? def.enabled : true),
                    description: typeof config[`apr_desc_${id}`] === "string"
                        ? config[`apr_desc_${id}`]
                        : (DESCRIPTIONS[id] || ""),
                };
            });
        }
        return DEFAULT_CRITERIA.map(d => ({
            id: d.id,
            name: d.name,
            group: validGroupIds.has(d.group) ? d.group : fallbackGroup,
            weight: d.weight,
            enabled: d.enabled && !coerceBool(config[LEGACY_DISABLE_KEYS[d.id]], false),
            description: DESCRIPTIONS[d.id] || "",
        }));
    }

    function configFromState(groups, criteria) {
        const input = {
            apr_group_ids: groups.map(g => g.id).join(","),
            apr_criteria_ids: criteria.map(c => c.id).join(","),
        };
        groups.forEach(g => {
            input[`apr_group_name_${g.id}`] = g.name;
            input[`apr_group_weight_${g.id}`] = String(g.weight);
        });
        criteria.forEach(c => {
            input[`apr_name_${c.id}`] = c.name;
            input[`apr_group_${c.id}`] = c.group;
            input[`apr_weight_${c.id}`] = String(c.weight);
            input[`apr_enabled_${c.id}`] = !!c.enabled;
            input[`apr_desc_${c.id}`] = c.description || "";
        });
        return input;
    }

    /* ─────────────────────────────────────────────────────────────────
       PERFORMER PAGE: rating modal trigger + modal
       ───────────────────────────────────────────────────────────────── */
    function tryInject(performerId) {
        if (document.querySelector('#perf-rating-trigger')) return true;
        const anchor = document.querySelector('.quality-group .rating-stars, .quality-group .rating-number');
        if (anchor) {
            injectTrigger(anchor, performerId);
            return true;
        }
        return false;
    }

    function startPolling(performerId) {
        if (pollTimer) clearInterval(pollTimer);
        let attempts = 0;
        pollTimer = setInterval(() => {
            attempts++;
            if (tryInject(performerId) || attempts >= 40) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
        }, 100);
    }

    let lastPath = null;
    function onLocationChange() {
        const urlMatch = window.location.pathname.match(/\/performers\/(\d+)/);
        if (urlMatch && !window.location.pathname.includes('edit')) {
            const performerId = urlMatch[1];
            if (window.location.pathname !== lastPath) {
                lastPath = window.location.pathname;
                const existing = document.querySelector('#perf-rating-trigger');
                if (existing) existing.remove();
                startPolling(performerId);
            }
        } else {
            lastPath = null;
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
            const existing = document.querySelector('#perf-rating-trigger');
            if (existing) existing.remove();
        }
    }

    PluginApi.Event.addEventListener('stash:location', onLocationChange);
    onLocationChange();

    async function getPerformerCustomFields(performerId) {
        const query = `query FindPerformerCF($id: ID!) { findPerformer(id: $id) { custom_fields } }`;
        const res = await gqlClient(query, { id: performerId });
        return (res.data && res.data.findPerformer && res.data.findPerformer.custom_fields) || {};
    }

    async function updatePerformerCustomField(performerId, key, value) {
        const partial = {};
        partial[key] = value;
        const mutation = `mutation PerformerUpdateCF($input: PerformerUpdateInput!) {
            performerUpdate(input: $input) { id }
        }`;
        await gqlClient(mutation, { input: { id: performerId, custom_fields: { partial } } });
    }

    /* Mirrors computeBreakdown but reads scores from custom fields instead of tags. */
    function computeBreakdownFromCustomFields(customFields, groups, criteria, ratingPrecision, cfPrefix) {
        const scoresByCriterion = {};
        for (const c of criteria) {
            const val = customFields[cfPrefix + c.name];
            if (val !== null && val !== undefined) {
                const s = parseInt(val, 10);
                if (!isNaN(s) && s !== 0) scoresByCriterion[c.id] = s;
            }
        }
        const groupRows = groups.map(g => {
            const groupCriteria = criteria.filter(c => c.group === g.id);
            const ratedCriteria = groupCriteria.filter(c => scoresByCriterion[c.id] !== undefined);
            const totalWeight = ratedCriteria.reduce((n, c) => n + (parseFloat(c.weight) || 0), 0);
            const weightedSum = ratedCriteria.reduce((n, c) => n + (scoresByCriterion[c.id] || 0) * (parseFloat(c.weight) || 0), 0);
            const avg = totalWeight > 0 ? weightedSum / totalWeight : null;
            return {
                group: g,
                criteriaInGroup: groupCriteria,
                rated: ratedCriteria,
                unrated: groupCriteria.filter(c => scoresByCriterion[c.id] === undefined),
                totalWeight, weightedSum, avg, scoresByCriterion,
            };
        });
        const contributingGroups = groupRows.filter(r => r.avg !== null && (parseFloat(r.group.weight) || 0) > 0);
        const totalGroupWeight = contributingGroups.reduce((n, r) => n + (parseFloat(r.group.weight) || 0), 0);
        const finalAvg = totalGroupWeight > 0
            ? contributingGroups.reduce((n, r) => n + r.avg * (parseFloat(r.group.weight) || 0), 0) / totalGroupWeight
            : null;
        let rating100 = null;
        if (finalAvg !== null) {
            const precision = Math.max(1, parseInt(ratingPrecision, 10) || 10);
            rating100 = Math.round(Math.round(finalAvg * 20 / precision) * precision);
            rating100 = Math.max(precision, Math.min(100, rating100));
        }
        const totalCriteria = criteria.length;
        const totalRated = Object.keys(scoresByCriterion).length;
        return {
            groupRows, contributingGroups, totalGroupWeight, finalAvg, rating100,
            totalCriteria, totalRated, totalUnrated: totalCriteria - totalRated,
            scoresByCriterion,
        };
    }

    function computeRating100FromCustomFields(customFields, groups, criteria, ratingPrecision, cfPrefix) {
        const enabled = criteria.filter(c => c.enabled);
        if (!enabled.length) return null;
        const hitsByGroup = {};
        groups.forEach(g => { hitsByGroup[g.id] = []; });
        let totalHits = 0;
        for (const c of enabled) {
            const val = customFields[cfPrefix + c.name];
            if (val === null || val === undefined) continue;
            const score = parseInt(val, 10);
            if (isNaN(score) || score === 0) continue;
            const bucket = hitsByGroup[c.group];
            if (!bucket) continue;
            bucket.push({ score, w: parseFloat(c.weight) || 0 });
            totalHits++;
        }
        if (totalHits < 1) return null;
        const contributions = [];
        for (const g of groups) {
            const hits = hitsByGroup[g.id] || [];
            const wsum = hits.reduce((n, h) => n + h.w, 0);
            if (wsum <= 0) continue;
            const gavg = hits.reduce((n, h) => n + h.score * h.w, 0) / wsum;
            const gw = parseFloat(g.weight) || 0;
            if (gw <= 0) continue;
            contributions.push({ avg: gavg, w: gw });
        }
        if (!contributions.length) return null;
        const totalW = contributions.reduce((n, c) => n + c.w, 0);
        const finalAvg = contributions.reduce((n, c) => n + c.avg * c.w, 0) / totalW;
        const precision = Math.max(1, parseInt(ratingPrecision, 10) || 20);
        let r100 = Math.round(Math.round(finalAvg * 20 / precision) * precision);
        return Math.max(precision, Math.min(100, r100));
    }

    function injectTrigger(ratingStars, performerId) {
        const triggerBtn = document.createElement('button');
        triggerBtn.id = 'perf-rating-trigger';
        triggerBtn.innerHTML =
            '<span class="adv-rating-btn-star" style="color:#ffc107;">★</span>' +
            '<span class="adv-rating-btn-plus">' +
                "<svg viewBox='0 0 24 24' fill='none' aria-hidden='true'>" +
                "<path d='M6 12H18M12 6V18' stroke='currentColor' " +
                    "stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'/>" +
                "</svg>" +
            '</span>';
        triggerBtn.title = "Open Performer Ratings";
        triggerBtn.className = 'adv-rating-btn';
        ratingStars.insertAdjacentElement('afterend', triggerBtn);
        triggerBtn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation(); openModal(performerId);
        });
        annotateUnratedCount(triggerBtn, performerId);
    }

    async function annotateUnratedCount(triggerBtn, performerId) {
        try {
            const config = await getPluginConfig();
            const groups = groupsFromConfig(config);
            const criteria = criteriaFromConfig(config, groups).filter(c => c.enabled);
            const cfPrefix = config.custom_field_prefix || "";
            const precision = await getStashRatingPrecision();
            const customFields = await getPerformerCustomFields(performerId);
            if (!triggerBtn.isConnected) return;
            const breakdown = computeBreakdownFromCustomFields(customFields, groups, criteria, precision, cfPrefix);
            if (breakdown.totalUnrated === 0) {
                triggerBtn.title = "Open Performer Ratings — all criteria rated";
                return;
            }
            triggerBtn.classList.add('adv-rating-btn--incomplete');
            if (breakdown.totalRated > 0) {
                triggerBtn.classList.add('adv-rating-btn--partial');
                triggerBtn.title = `Open Performer Ratings — ${breakdown.totalUnrated} of ${breakdown.totalCriteria} criteria still unrated`;
            } else {
                triggerBtn.title = `Open Performer Ratings — ${breakdown.totalCriteria} criteria to rate`;
            }
            const badge = document.createElement('span');
            badge.className = 'adv-rating-btn-badge';
            badge.innerText = breakdown.totalUnrated;
            triggerBtn.appendChild(badge);
        } catch (e) {
            console.warn("[advancedPerformerRating] annotate failed", e);
        }
    }

    async function openModal(performerId) {
        if (document.querySelector('#perf-rating-modal')) return;
        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'perf-rating-modal';
        modalOverlay.className = 'adv-rating-modal-overlay';
        const modalContent = document.createElement('div');
        modalContent.className = 'adv-rating-modal-content';
        modalContent.innerHTML = `
            <div class="adv-rating-header">
                <div>
                    <h3>Performer Ratings</h3>
                    <div class="adv-rating-subhead"></div>
                </div>
                <span class="perf-rating-close">&times;</span>
            </div>
            <div class="ratings-list">Loading…</div>
            <div class="adv-rating-breakdown"></div>
        `;
        modalOverlay.appendChild(modalContent);
        document.body.appendChild(modalOverlay);
        const handleClose = () => { modalOverlay.remove(); window.location.reload(); };
        modalContent.querySelector('.perf-rating-close').addEventListener('click', handleClose);
        modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) handleClose(); });

        const config = await getPluginConfig();
        const cfPrefix = config.custom_field_prefix || "";
        const groups = groupsFromConfig(config);
        const criteria = criteriaFromConfig(config, groups).filter(c => c.enabled);
        const precision = await getStashRatingPrecision();

        let customFields = await getPerformerCustomFields(performerId);

        function render() {
            const listContainer = modalContent.querySelector('.ratings-list');
            const subhead = modalContent.querySelector('.adv-rating-subhead');
            const breakdownEl = modalContent.querySelector('.adv-rating-breakdown');
            listContainer.innerHTML = '';

            const breakdown = computeBreakdownFromCustomFields(customFields, groups, criteria, precision, cfPrefix);
            const { scoresByCriterion, totalRated, totalUnrated } = breakdown;

            subhead.innerHTML = '';
            const summary = document.createElement('span');
            summary.className = 'adv-rating-summary';
            summary.innerText = `${criteria.length} criteria · ${totalRated} rated`;
            if (totalUnrated > 0) {
                summary.innerHTML += ` · <span class="adv-rating-unrated-pill">${totalUnrated} unrated</span>`;
            }
            subhead.appendChild(summary);

            groups.forEach(g => {
                const groupCriteria = criteria.filter(c => c.group === g.id);
                if (!groupCriteria.length) return;

                const groupHeader = document.createElement('div');
                groupHeader.className = 'adv-rating-group-header';
                groupHeader.innerText = g.name;
                listContainer.appendChild(groupHeader);

                groupCriteria.forEach(c => {
                    const score = scoresByCriterion[c.id] !== undefined ? scoresByCriterion[c.id] : null;
                    const row = document.createElement('div');
                    row.className = 'rating-row' + (score === null ? ' rating-unrated' : '');
                    const label = document.createElement('span'); label.className = 'rating-label';
                    const labelText = document.createElement('span'); labelText.innerText = c.name; label.appendChild(labelText);
                    if (score === null) {
                        const pill = document.createElement('span');
                        pill.className = 'adv-rating-unrated-pill';
                        pill.innerText = 'unrated';
                        label.appendChild(pill);
                    }
                    const desc = c.description;
                    if (desc) {
                        const infoIcon = document.createElement('span'); infoIcon.className = 'rating-info-icon'; infoIcon.innerHTML = 'ⓘ';
                        const tooltip = document.createElement('div'); tooltip.className = 'rating-tooltip'; tooltip.innerText = desc;
                        infoIcon.appendChild(tooltip); label.appendChild(infoIcon);
                    }
                    const starsDiv = document.createElement('div'); starsDiv.className = 'rating-stars-modal';
                    for (let i = 1; i <= 5; i++) {
                        const star = document.createElement('span'); star.className = 'rating-star';
                        star.innerHTML = (score !== null && i <= score) ? '★' : '☆';
                        star.addEventListener('mouseenter', () => {
                            starsDiv.querySelectorAll('.rating-star').forEach((s, idx) => {
                                s.classList.toggle('hovered', idx < i);
                            });
                        });
                        star.addEventListener('mouseleave', () => {
                            starsDiv.querySelectorAll('.rating-star').forEach(s => s.classList.remove('hovered'));
                        });
                        star.addEventListener('click', async () => {
                            listContainer.style.opacity = '0.5';
                            await updatePerformerCustomField(performerId, cfPrefix + c.name, i);
                            customFields = await getPerformerCustomFields(performerId);
                            render();
                            listContainer.style.opacity = '1';
                        });
                        starsDiv.appendChild(star);
                    }
                    const clearBtn = document.createElement('span'); clearBtn.className = 'rating-clear'; clearBtn.innerHTML = '×';
                    clearBtn.title = 'Remove Category Rating';
                    clearBtn.addEventListener('click', async () => {
                        listContainer.style.opacity = '0.5';
                        await updatePerformerCustomField(performerId, cfPrefix + c.name, null);
                        customFields = await getPerformerCustomFields(performerId);
                        render();
                        listContainer.style.opacity = '1';
                    });
                    starsDiv.appendChild(clearBtn);
                    row.appendChild(label); row.appendChild(starsDiv); listContainer.appendChild(row);
                });
            });

            renderBreakdown(breakdownEl, breakdown);
        }

        function renderBreakdown(container, b) {
            container.innerHTML = '';
            const open = localStorage.getItem('aprBreakdownOpen') === '1';
            const heading = document.createElement('button');
            heading.type = 'button';
            heading.className = 'adv-rating-breakdown-heading' + (open ? ' open' : '');
            heading.innerHTML = `<span class="adv-rating-breakdown-caret">▶</span>Score breakdown`;
            container.appendChild(heading);

            const body = document.createElement('div');
            body.className = 'adv-rating-breakdown-body' + (open ? ' open' : '');
            container.appendChild(body);

            heading.addEventListener('click', () => {
                const nowOpen = !heading.classList.contains('open');
                heading.classList.toggle('open', nowOpen);
                body.classList.toggle('open', nowOpen);
                localStorage.setItem('aprBreakdownOpen', nowOpen ? '1' : '0');
            });

            if (b.totalRated === 0) {
                const empty = document.createElement('div');
                empty.className = 'adv-rating-breakdown-empty';
                empty.innerText = 'Rate at least one criterion to see the calculation.';
                body.appendChild(empty);
                return;
            }

            b.groupRows.forEach(row => {
                if (!row.criteriaInGroup.length) return;
                const groupBlock = document.createElement('div');
                groupBlock.className = 'adv-rating-breakdown-group';
                const head = document.createElement('div');
                head.className = 'adv-rating-breakdown-group-head';
                const name = document.createElement('span');
                name.className = 'adv-rating-breakdown-name';
                name.innerText = row.group.name;
                head.appendChild(name);
                const weightBadge = document.createElement('span');
                weightBadge.className = 'adv-rating-breakdown-weight';
                weightBadge.innerText = 'group weight: ' + row.group.weight;
                head.appendChild(weightBadge);
                groupBlock.appendChild(head);

                if (row.rated.length === 0) {
                    const noScore = document.createElement('div');
                    noScore.className = 'adv-rating-breakdown-empty';
                    noScore.innerText = 'No rated criteria in this group — skipped.';
                    groupBlock.appendChild(noScore);
                } else {
                    const terms = row.rated.map(c => `${row.scoresByCriterion[c.id]}×${c.weight}`);
                    const formula = document.createElement('div');
                    formula.className = 'adv-rating-breakdown-formula';
                    formula.innerHTML = `(${terms.join(' + ')}) ÷ ${row.totalWeight} = <b>${row.avg.toFixed(2)}</b>`;
                    groupBlock.appendChild(formula);
                    if (row.unrated.length) {
                        const note = document.createElement('div');
                        note.className = 'adv-rating-breakdown-note';
                        note.innerText = `${row.unrated.length} unrated: ${row.unrated.map(c => c.name).join(', ')}`;
                        groupBlock.appendChild(note);
                    }
                }
                body.appendChild(groupBlock);
            });

            const finalBlock = document.createElement('div');
            finalBlock.className = 'adv-rating-breakdown-final';
            if (b.contributingGroups.length && b.finalAvg !== null) {
                const finalTerms = b.contributingGroups.map(r => `${r.avg.toFixed(2)}×${r.group.weight}`);
                finalBlock.innerHTML = `<b>Final:</b> (${finalTerms.join(' + ')}) ÷ ${b.totalGroupWeight} = <b>${b.finalAvg.toFixed(2)}</b>/5 → <b>${b.rating100}</b>/100`;
            } else {
                finalBlock.innerText = 'No contributing groups — rating not updated.';
            }
            body.appendChild(finalBlock);
        }

        render();
    }

    /* ─────────────────────────────────────────────────────────────────
       SETTINGS PANEL
       ───────────────────────────────────────────────────────────────── */
    function buildSettingsPanel() {
        const R = PluginApi.React;
        return function AdvPerformerRatingSettings() {
            const [groups, setGroups] = R.useState(null);
            const [criteria, setCriteria] = R.useState(null);
            const [general, setGeneral] = R.useState(null);
            const [loadError, setLoadError] = R.useState(null);
            const [savingState, setSavingState] = R.useState({ saving: false, message: null, kind: null });
            const [editingDescId, setEditingDescId] = R.useState(null);

            R.useEffect(function () {
                let cancelled = false;
                Promise.all([getPluginConfig(), getStashRatingInfo()])
                    .then(function (results) {
                        if (cancelled) return;
                        const cfg = results[0];
                        const info = results[1];
                        const gs = groupsFromConfig(cfg);
                        setGroups(gs);
                        setCriteria(criteriaFromConfig(cfg, gs));
                        setGeneral({
                            rating_precision: info.precision,
                            rating_precision_label: info.label,
                        });
                    })
                    .catch(function (e) {
                        if (cancelled) return;
                        setLoadError(String(e));
                    });
                return function () { cancelled = true; };
            }, []);

            R.useEffect(function () {
                const interval = setInterval(async function () {
                    try {
                        const info = await getStashRatingInfo();
                        setGeneral(function (cur) {
                            if (!cur) return cur;
                            if (cur.rating_precision === info.precision && cur.rating_precision_label === info.label) return cur;
                            return Object.assign({}, cur, {
                                rating_precision: info.precision,
                                rating_precision_label: info.label,
                            });
                        });
                    } catch (e) { /* ignore */ }
                }, 3000);
                return function () { clearInterval(interval); };
            }, []);

            function updateCriterion(idx, patch) {
                setCriteria(function (cur) {
                    const next = cur.slice();
                    next[idx] = Object.assign({}, next[idx], patch);
                    return next;
                });
            }
            function removeCriterion(idx) {
                setCriteria(function (cur) { return cur.filter(function (_, i) { return i !== idx; }); });
            }
            function moveCriterion(idx, dir) {
                setCriteria(function (cur) {
                    const j = idx + dir;
                    if (j < 0 || j >= cur.length) return cur;
                    const next = cur.slice();
                    const tmp = next[idx]; next[idx] = next[j]; next[j] = tmp;
                    return next;
                });
            }
            function addCriterion() {
                setCriteria(function (cur) {
                    const id = "custom_" + Date.now().toString(36);
                    const fallbackGroup = groups[0] ? groups[0].id : "physical";
                    return cur.concat([{ id, name: "New criterion", group: fallbackGroup, weight: 1, enabled: true, description: "" }]);
                });
            }
            function updateGroup(idx, patch) {
                setGroups(function (cur) {
                    const next = cur.slice();
                    next[idx] = Object.assign({}, next[idx], patch);
                    return next;
                });
            }
            function moveGroup(idx, dir) {
                setGroups(function (cur) {
                    const j = idx + dir;
                    if (j < 0 || j >= cur.length) return cur;
                    const next = cur.slice();
                    const tmp = next[idx]; next[idx] = next[j]; next[j] = tmp;
                    return next;
                });
            }
            function addGroup() {
                setGroups(function (cur) {
                    const id = "group_" + Date.now().toString(36);
                    return cur.concat([{ id, name: "New group", weight: 1 }]);
                });
            }
            function removeGroup(idx) {
                const g = groups[idx];
                if (!g) return;
                if (groups.length <= 1) {
                    alert("At least one group is required.");
                    return;
                }
                const using = criteria.filter(function (c) { return c.group === g.id; });
                const reassignTo = (groups.find(function (other, i) { return i !== idx; }) || {}).id;
                const msg = using.length
                    ? "Remove group \"" + g.name + "\"?\n" + using.length + " criterion/criteria will be reassigned to \"" + reassignTo + "\"."
                    : "Remove group \"" + g.name + "\"?";
                if (!confirm(msg)) return;
                setGroups(function (cur) { return cur.filter(function (_, i) { return i !== idx; }); });
                if (using.length) {
                    setCriteria(function (cur) {
                        return cur.map(function (c) {
                            return c.group === g.id ? Object.assign({}, c, { group: reassignTo }) : c;
                        });
                    });
                }
            }
            function resetDefaults() {
                if (!confirm("Reset all groups and criteria to defaults?\nUnsaved edits will be lost.")) return;
                setGroups(DEFAULT_GROUPS.map(function (d) { return Object.assign({}, d); }));
                setCriteria(DEFAULT_CRITERIA.map(function (d) { return Object.assign({}, d); }));
            }

            async function recalcAll() {
                if (!confirm("Recalculate ratings for all performers? This walks every performer and updates their rating100 based on the current configuration.")) return;
                setSavingState({ saving: true, message: "Loading performers…", kind: "info" });
                try {
                    const cfg = await getPluginConfig();
                    const res = await recalculateAllPerformers(groups, criteria, cfg, function (done, total, updated) {
                        setSavingState({ saving: true, message: "Processed " + done + " / " + total + " (" + updated + " updated)", kind: "info" });
                    });
                    setSavingState({ saving: false, message: "Recalc complete: " + res.updated + " updated, " + res.skipped + " unchanged of " + res.total + ".", kind: "success" });
                } catch (e) {
                    setSavingState({ saving: false, message: "Recalc failed: " + (e && e.message ? e.message : e), kind: "error" });
                }
            }

            async function save() {
                setSavingState({ saving: true, message: "Saving…", kind: "info" });
                try {
                    if (!groups.length) throw new Error("At least one group is required");
                    const gids = groups.map(function (g) { return g.id; });
                    const gdupes = gids.filter(function (id, i) { return gids.indexOf(id) !== i; });
                    if (gdupes.length) throw new Error("Duplicate group ids: " + gdupes.join(", "));
                    const validGroupIds = new Set(gids);
                    for (const g of groups) {
                        if (!g.name || !g.name.trim()) throw new Error("Every group needs a name");
                        if (!Number.isFinite(g.weight) || g.weight < 0) throw new Error("Group weight must be a non-negative number");
                    }

                    const ids = criteria.map(function (c) { return c.id; });
                    const dupes = ids.filter(function (id, i) { return ids.indexOf(id) !== i; });
                    if (dupes.length) throw new Error("Duplicate criterion ids: " + dupes.join(", "));
                    for (const c of criteria) {
                        if (!c.name || !c.name.trim()) throw new Error("Every criterion needs a name");
                        if (!Number.isFinite(c.weight) || c.weight < 0) throw new Error("Weight must be a non-negative number");
                        if (!validGroupIds.has(c.group)) throw new Error("Criterion \"" + c.name + "\" references unknown group \"" + c.group + "\"");
                    }

                    await configurePlugin(configFromState(groups, criteria));
                    setSavingState({ saving: false, message: "Saved.", kind: "success" });
                } catch (e) {
                    setSavingState({ saving: false, message: "Save failed: " + (e && e.message ? e.message : e), kind: "error" });
                }
            }

            if (loadError) {
                return R.createElement("div", { className: "plugin-settings" },
                    R.createElement("div", { className: "setting" },
                        R.createElement("div", null,
                            R.createElement("h3", null, "Advanced Performer Rating"),
                            R.createElement("div", { className: "sub-heading" }, "Failed to load config: " + loadError))));
            }
            if (criteria === null || groups === null || general === null) {
                return R.createElement("div", { className: "plugin-settings" },
                    R.createElement("div", { className: "setting" },
                        R.createElement("div", null, R.createElement("h3", null, "Loading…"))));
            }

            const rows = criteria.map(function (c, idx) {
                const isEditingDesc = editingDescId === c.id;
                const previewDesc = c.description || "";
                return R.createElement("div", {
                    key: c.id,
                    className: "setting apr-criterion-row" + (c.enabled ? "" : " apr-disabled"),
                },
                    R.createElement("div", { className: "apr-criterion-main" },
                        R.createElement("div", { className: "apr-criterion-toggle" },
                            R.createElement("div", { className: "custom-control custom-switch" },
                                R.createElement("input", {
                                    type: "checkbox",
                                    className: "custom-control-input",
                                    id: "apr-enabled-" + c.id,
                                    checked: !!c.enabled,
                                    onChange: function (e) { updateCriterion(idx, { enabled: e.target.checked }); },
                                }),
                                R.createElement("label", {
                                    className: "custom-control-label",
                                    htmlFor: "apr-enabled-" + c.id,
                                }))),
                        R.createElement("input", {
                            type: "text",
                            className: "form-control apr-name-input",
                            value: c.name,
                            placeholder: "Display name",
                            onChange: function (e) { updateCriterion(idx, { name: e.target.value }); },
                        }),
                        R.createElement("select", {
                            className: "form-control apr-group-select",
                            value: c.group,
                            onChange: function (e) { updateCriterion(idx, { group: e.target.value }); },
                        }, groups.map(function (g) {
                            return R.createElement("option", { key: g.id, value: g.id }, g.name);
                        })),
                        R.createElement("input", {
                            type: "number",
                            className: "form-control apr-weight-input",
                            value: c.weight,
                            min: 0,
                            step: 0.5,
                            onChange: function (e) { updateCriterion(idx, { weight: coerceFloat(e.target.value, 1) }); },
                        }),
                        R.createElement("div", { className: "apr-row-actions" },
                            R.createElement("button", {
                                type: "button",
                                className: "btn btn-secondary btn-sm" + (isEditingDesc ? " active" : ""),
                                title: "Edit description",
                                onClick: function () { setEditingDescId(isEditingDesc ? null : c.id); },
                            }, "✎"),
                            R.createElement("button", {
                                type: "button",
                                className: "btn btn-secondary btn-sm",
                                title: "Move up",
                                disabled: idx === 0,
                                onClick: function () { moveCriterion(idx, -1); },
                            }, "↑"),
                            R.createElement("button", {
                                type: "button",
                                className: "btn btn-secondary btn-sm",
                                title: "Move down",
                                disabled: idx === criteria.length - 1,
                                onClick: function () { moveCriterion(idx, 1); },
                            }, "↓"),
                            R.createElement("button", {
                                type: "button",
                                className: "btn btn-danger btn-sm",
                                title: "Remove criterion from this configuration.",
                                onClick: function () {
                                    if (confirm("Remove criterion \"" + c.name + "\" from this configuration?")) {
                                        removeCriterion(idx);
                                    }
                                },
                            }, "×"))),
                    isEditingDesc
                        ? R.createElement("div", { className: "apr-desc-editor" },
                            R.createElement("textarea", {
                                className: "form-control apr-desc-textarea",
                                rows: 4,
                                placeholder: "Tooltip shown in the performer rating modal.",
                                value: c.description || "",
                                onChange: function (e) { updateCriterion(idx, { description: e.target.value }); },
                            }),
                            R.createElement("div", { className: "apr-desc-editor-actions" },
                                DESCRIPTIONS[c.id] ? R.createElement("button", {
                                    type: "button",
                                    className: "btn btn-link btn-sm",
                                    title: "Reset to the bundled default for this criterion",
                                    onClick: function () { updateCriterion(idx, { description: DESCRIPTIONS[c.id] }); },
                                }, "Reset to default") : null,
                                R.createElement("button", {
                                    type: "button",
                                    className: "btn btn-secondary btn-sm",
                                    onClick: function () { setEditingDescId(null); },
                                }, "Close")))
                        : (previewDesc ? R.createElement("div", { className: "apr-criterion-desc sub-heading" }, previewDesc) : null),
                );
            });

            const msgClass = savingState.kind === "error" ? "apr-msg apr-msg-error"
                : savingState.kind === "success" ? "apr-msg apr-msg-success"
                : "apr-msg";

            const groupRows = groups.map(function (g, idx) {
                const usingCount = criteria.filter(function (c) { return c.group === g.id; }).length;
                return R.createElement("div", {
                    key: g.id,
                    className: "setting apr-group-row",
                },
                    R.createElement("div", { className: "apr-group-main" },
                        R.createElement("input", {
                            type: "text",
                            className: "form-control apr-group-name-input",
                            value: g.name,
                            placeholder: "Group name",
                            onChange: function (e) { updateGroup(idx, { name: e.target.value }); },
                        }),
                        R.createElement("input", {
                            type: "number",
                            className: "form-control apr-group-weight-input",
                            value: g.weight,
                            min: 0,
                            step: 0.5,
                            title: "Group weight in the final score",
                            onChange: function (e) { updateGroup(idx, { weight: coerceFloat(e.target.value, 1) }); },
                        }),
                        R.createElement("span", { className: "apr-group-usage" },
                            usingCount + " criterion" + (usingCount === 1 ? "" : "ia")),
                        R.createElement("div", { className: "apr-row-actions" },
                            R.createElement("button", {
                                type: "button",
                                className: "btn btn-secondary btn-sm",
                                title: "Move up",
                                disabled: idx === 0,
                                onClick: function () { moveGroup(idx, -1); },
                            }, "↑"),
                            R.createElement("button", {
                                type: "button",
                                className: "btn btn-secondary btn-sm",
                                title: "Move down",
                                disabled: idx === groups.length - 1,
                                onClick: function () { moveGroup(idx, 1); },
                            }, "↓"),
                            R.createElement("button", {
                                type: "button",
                                className: "btn btn-danger btn-sm",
                                title: "Delete group",
                                disabled: groups.length <= 1,
                                onClick: function () { removeGroup(idx); },
                            }, "×"))));
            });

            const generalSection = [
                R.createElement("div", { key: "g-prec", className: "setting" },
                    R.createElement("div", null,
                        R.createElement("h3", null, "Rating Star Precision"),
                        R.createElement("div", { className: "sub-heading" },
                            "Auto-matched to Stash's rating system setting (Settings → Interface → Editing → Rating System). Change it there and reopen this panel.")),
                    R.createElement("div", { className: "apr-general-control" },
                        R.createElement("span", { className: "apr-readonly" },
                            general.rating_precision_label + " (" + general.rating_precision + ")"))),
            ];

            return R.createElement("div", { className: "plugin-settings apr-settings" },
                generalSection,
                R.createElement("div", { className: "setting" },
                    R.createElement("div", null,
                        R.createElement("h3", null, "Groups"),
                        R.createElement("div", { className: "sub-heading" },
                            "Criteria are bucketed into groups; each group has its own weight. The final score is the weighted mean of each group's weighted-criterion average. With one group it's a flat weighted average; with several, group weights balance them. Groups with no enabled criteria for a given performer are skipped."))),
                groupRows,
                R.createElement("div", { className: "setting apr-add-row" },
                    R.createElement("button", {
                        type: "button",
                        className: "btn btn-primary",
                        onClick: addGroup,
                    }, "+ Add group")),
                R.createElement("div", { className: "setting" },
                    R.createElement("div", null,
                        R.createElement("h3", null, "Criteria"),
                        R.createElement("div", { className: "sub-heading" },
                            "Criterion names are used as custom field keys (with optional prefix from plugin settings). Rename or reorder freely; weights drive the weighted average within each group, then groups combine using their own weights. Disabled criteria are ignored."))),
                rows,
                R.createElement("div", { className: "setting apr-add-row" },
                    R.createElement("button", {
                        type: "button",
                        className: "btn btn-primary",
                        onClick: addCriterion,
                    }, "+ Add criterion")),
                R.createElement("div", { className: "setting apr-actions" },
                    R.createElement("button", {
                        type: "button",
                        className: "btn btn-primary",
                        disabled: savingState.saving,
                        title: "Persist configuration",
                        onClick: save,
                    }, "Save"),
                    R.createElement("button", {
                        type: "button",
                        className: "btn btn-secondary",
                        disabled: savingState.saving,
                        title: "Walk every performer and update their rating from their custom fields",
                        onClick: recalcAll,
                    }, "Recalculate all performers"),
                    R.createElement("button", {
                        type: "button",
                        className: "btn btn-secondary",
                        disabled: savingState.saving,
                        onClick: resetDefaults,
                    }, "Reset to defaults"),
                    savingState.message ? R.createElement("span", { className: msgClass }, savingState.message) : null,
                ));
        };
    }

    async function recalculateAllPerformers(groups, criteria, config, onProgress) {
        const ratingPrecision = await getStashRatingPrecision();
        const cfPrefix = config.custom_field_prefix || "";
        const res = await gqlClient(`{
            findPerformers(filter: {per_page: -1}) {
                count
                performers { id name rating100 custom_fields }
            }
        }`);
        const performers = (res.data && res.data.findPerformers && res.data.findPerformers.performers) || [];
        let updated = 0, skipped = 0;
        for (let i = 0; i < performers.length; i++) {
            const p = performers[i];
            const newRating = computeRating100FromCustomFields(p.custom_fields || {}, groups, criteria, ratingPrecision, cfPrefix);
            if (newRating === null || newRating === p.rating100) { skipped++; }
            else {
                await gqlClient(`mutation($input: PerformerUpdateInput!) {
                    performerUpdate(input: $input) { id }
                }`, { input: { id: p.id, rating100: newRating } });
                updated++;
            }
            if (onProgress) onProgress(i + 1, performers.length, updated, skipped);
        }
        return { total: performers.length, updated, skipped };
    }

    function registerSettingsPatch() {
        if (typeof PluginApi === "undefined" || !PluginApi.patch || !PluginApi.React) {
            setTimeout(registerSettingsPatch, 100);
            return;
        }
        const Panel = buildSettingsPanel();
        console.log("[advancedPerformerRating] registering PluginSettings patch");
        PluginApi.patch.instead("PluginSettings", function () {
            const args = Array.prototype.slice.call(arguments);
            const next = args.pop();
            const props = args[0];
            if (!window.__aprLoggedProps) {
                console.log("[advancedPerformerRating] PluginSettings props:", props);
                window.__aprLoggedProps = true;
            }
            const incomingId = props && (props.pluginID || props.pluginId || props.id);
            if (incomingId !== PLUGIN_ID) {
                return next.apply(null, args);
            }
            return PluginApi.React.createElement(Panel);
        });
    }
    registerSettingsPatch();
})();
