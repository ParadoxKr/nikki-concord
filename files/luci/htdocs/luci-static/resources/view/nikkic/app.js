'use strict';
'require view';
'require uci';
'require tools.nikkic as nikkic';
'require tools.nikkic-ui as ui';

const RLIMIT_FIELDS = [
    { key: 'rlimit_nofile_soft', label: () => _('Number of Open Files Soft Limit'), ph: '65536' },
    { key: 'rlimit_nofile_hard', label: () => _('Number of Open Files Hard Limit'), ph: '65536' },
    { key: 'rlimit_nproc_soft', label: () => _('Number of Processes Soft Limit'), ph: () => _('Unlimited') },
    { key: 'rlimit_nproc_hard', label: () => _('Number of Processes Hard Limit'), ph: () => _('Unlimited') },
    { key: 'rlimit_address_space_soft', label: () => _('Address Space Size Soft Limit'), ph: () => _('Unlimited') },
    { key: 'rlimit_address_space_hard', label: () => _('Address Space Size Hard Limit'), ph: () => _('Unlimited') },
    { key: 'rlimit_data_soft', label: () => _('Heap Size Soft Limit'), ph: () => _('Unlimited') },
    { key: 'rlimit_data_hard', label: () => _('Heap Size Hard Limit'), ph: () => _('Unlimited') },
    { key: 'rlimit_stack_soft', label: () => _('Stack Size Soft Limit'), ph: () => _('Unlimited') },
    { key: 'rlimit_stack_hard', label: () => _('Stack Size Hard Limit'), ph: () => _('Unlimited') }
];

function phaseLabel(st) {
    if (st && st.phase === 'starting') return _('Starting upgrade...');
    if (st && st.phase === 'checking') return _('Checking release metadata...');
    if (st && st.phase === 'downloading') return _('Downloading package and checksums...');
    if (st && st.phase === 'verifying') return _('Verifying SHA256 checksum...');
    if (st && st.phase === 'installing') return _('Installing package...');
    return (st && st.message) || _('Starting upgrade...');
}

function phasePercent(st) {
    const map = { starting: 12, checking: 25, downloading: 58, verifying: 82, installing: 92 };
    return map[st && st.phase] || 30;
}

const appSpec = {
    load: function () {
        if (ui.isClassicMode()) return ui.delegateClassic('app').load();
        return Promise.all([
            uci.load('nikkic'),
            nikkic.overview('vsu'),
            nikkic.listProfiles()
        ]);
    },

    render: function (data) {
        if (ui.isClassicMode()) return ui.delegateClassic('app').render(data);

        const ov = data[1] || {};
        const ver = ov.version || {};
        const initStatus = ov.status || {};
        const localFiles = (data[2] || []).filter(function (f) { return f && f.name && /\.(ya?ml)$/i.test(f.name); });
        const initWarnings = ov.warnings || {};
        const initUpgrade = ov.upgrade || { state: 'idle' };
        const stats = ov.stats || { files: {}, active_smart: '' };

        const subs = uci.sections('nikkic', 'subscription') || [];
        // Treat the built-in unedited placeholder subscription + default.yaml only as fresh install
        const userSubs = subs.filter(function (s) {
            return !(s['.name'] === 'subscription' && s.url === 'http://example.com/default.yaml');
        });
        const userLocal = localFiles.filter(function (f) {
            return !(f.name === 'default.yaml' && (f.size || 0) <= 64);
        });
        const allProfiles = [];
        userSubs.forEach(function (s) {
            allProfiles.push({
                id: 'subscription:' + s['.name'],
                type: 'subscription',
                name: s.name || s['.name'],
                used: s.used,
                total: s.total,
                expire: s.expire,
                stat: (stats.files || {})['subscription:' + s['.name']] || {}
            });
        });
        userLocal.forEach(function (f) {
            allProfiles.push({
                id: 'file:' + f.name,
                type: 'file',
                name: f.name,
                size: f.size,
                stat: (stats.files || {})['file:' + f.name] || {}
            });
        });
        // If user has an active configured profile that wasn't filtered in, include it
        const configuredProfile = uci.get('nikkic', 'config', 'profile') || '';
        if (allProfiles.length === 0 && configuredProfile && localFiles.some(function (f) { return 'file:' + f.name === configuredProfile; })) {
            const hit = localFiles.find(function (f) { return 'file:' + f.name === configuredProfile; });
            if (hit && (hit.size || 0) > 64) {
                allProfiles.push({ id: configuredProfile, type: 'file', name: hit.name, size: hit.size, stat: (stats.files || {})[configuredProfile] || {} });
            }
        }
        const isFresh = allProfiles.length === 0;

        // Editable state (only saved when clicking Save; master enable is immediate start/stop!)
        function readSnapshot() {
            const snap = {
                profile: uci.get('nikkic', 'config', 'profile') || (allProfiles[0] ? allProfiles[0].id : ''),
                fast_reload: uci.get('nikkic', 'procd', 'fast_reload') === '1',
                core_only: uci.get('nikkic', 'config', 'core_only') === '1',
                scheduled_restart: uci.get('nikkic', 'config', 'scheduled_restart') === '1',
                scheduled_restart_cron: uci.get('nikkic', 'config', 'scheduled_restart_cron') || '0 3 * * *',
                start_delay: uci.get('nikkic', 'config', 'start_delay') || ''
            };
            RLIMIT_FIELDS.forEach(function (f) {
                snap[f.key] = uci.get('nikkic', 'procd', f.key) || '';
            });
            return snap;
        }

        let initial = readSnapshot();
        let draft = Object.assign({}, initial);

        function countDirty() {
            let n = 0;
            Object.keys(initial).forEach(function (k) {
                if (draft[k] !== initial[k]) n++;
            });
            return n;
        }

        async function commitDraft() {
            if (draft.profile !== initial.profile) uci.set('nikkic', 'config', 'profile', draft.profile || '');
            if (draft.fast_reload !== initial.fast_reload) uci.set('nikkic', 'procd', 'fast_reload', draft.fast_reload ? '1' : '0');
            if (draft.core_only !== initial.core_only) uci.set('nikkic', 'config', 'core_only', draft.core_only ? '1' : '0');
            if (draft.scheduled_restart !== initial.scheduled_restart) uci.set('nikkic', 'config', 'scheduled_restart', draft.scheduled_restart ? '1' : '0');
            if (draft.scheduled_restart_cron !== initial.scheduled_restart_cron) uci.set('nikkic', 'config', 'scheduled_restart_cron', draft.scheduled_restart_cron || '0 3 * * *');
            if (draft.start_delay !== initial.start_delay) uci.set('nikkic', 'config', 'start_delay', draft.start_delay || '0');
            RLIMIT_FIELDS.forEach(function (f) {
                if (draft[f.key] === initial[f.key]) return;
                const v = String(draft[f.key] || '').trim();
                if (v) uci.set('nikkic', 'procd', f.key, v);
                else uci.unset('nikkic', 'procd', f.key);
            });
            await ui.commitUci();
            initial = Object.assign({}, draft);
            shell.setDirtyCount(0);
        }

        let upgradeActive = false;
        let previousUpgrade = '';

        const shell = ui.createShell({
            activeTab: 'config',
            showSave: true,
            onReset: function () {
                draft = Object.assign({}, initial);
                syncFormUI();
                shell.setDirtyCount(0);
            },
            onSave: function () {
                return ui.saveWithSmartReload(shell, commitDraft);
            }
        });

        function refreshDirty() {
            shell.setDirtyCount(countDirty());
        }

        // Master 42px Enable/Stop button (immediate service lifecycle action)
        const masterBtn = ui.createEnableBtn({
            size: 'lg',
            enabled: !!(initStatus.running),
            onClick: async function (ev) {
                ev.stopPropagation();
                const currentlyRunning = shell.isRunning();
                if (currentlyRunning) {
                    shell.setBusy(_('Stopping...'), 'var(--sp-warning)');
                    try {
                        uci.set('nikkic', 'config', 'enabled', '0');
                        await ui.commitUci();
                        await nikkic.action('stop');
                    } catch (_) {}
                    const st = await nikkic.status();
                    shell.endBusy(st);
                    syncRunningUI(st);
                    masterBtn.setEnabled(!!st.running, true);
                    return;
                }
                if (isFresh) {
                    shell.setFeed('prompt', false, [
                        E('div', { style: 'color:var(--sp-warning);font-weight:600;' }, _('No profile added yet. Please add a profile first.'))
                    ]);
                    return;
                }
                const pending = countDirty();
                if (pending > 0) {
                    shell.setFeed('prompt', false, [
                        E('div', { style: 'color:var(--sp-warning);font-weight:600;' },
                            _('There are %d unsaved changes').format ? _('There are %d unsaved changes').format(pending) : (pending + ' ' + _('unsaved changes'))),
                        E('div', { class: 'nk-feed-actions' }, [
                            E('button', {
                                type: 'button',
                                class: 'nk-btn nk-btn-sm nk-btn-accent',
                                click: async function () {
                                    shell.setFeed('none', false, []);
                                    await startNow(true);
                                }
                            }, _('Save & Start')),
                            E('button', {
                                type: 'button',
                                class: 'nk-btn nk-btn-sm',
                                click: function () {
                                    shell.setFeed('none', false, []);
                                    shell.applyWarnings(initWarnings);
                                }
                            }, _('Cancel'))
                        ])
                    ]);
                    return;
                }
                await startNow(false);
            }
        });

        async function startNow(shouldCommit) {
            shell.setBusy(_('Starting...'), 'var(--sp-cobalt)');
            try {
                if (shouldCommit) await commitDraft();
                uci.set('nikkic', 'config', 'enabled', '1');
                await ui.commitUci();
                await nikkic.action('start');
            } catch (_) {}
            const [st, warn] = await Promise.all([nikkic.status(), nikkic.configWarnings()]);
            shell.endBusy(st);
            shell.applyWarnings(warn);
            syncRunningUI(st);
            masterBtn.setEnabled(!!st.running, true);
        }

        // Profile horizontal strip
        const profileCardNodes = [];
        const profileStrip = E('div', { class: 'nk-profile-strip' });
        if (isFresh) {
            const addBtn = E('button', {
                type: 'button',
                class: 'nk-profile-empty-add',
                click: function () { ui.navigateTo('profile', true); }
            }, [ui.svgEl('plus'), E('span', {}, _('Add Profile'))]);
            profileStrip.appendChild(addBtn);
        } else {
            allProfiles.forEach(function (p) {
                const usedGb = ui.parseSizeToGB(p.used);
                const totalGb = ui.parseSizeToGB(p.total);
                const hasTraffic = totalGb && totalGb > 0;
                const remainGb = hasTraffic ? Math.max(0, totalGb - (usedGb || 0)) : 0;
                const pct = hasTraffic ? Math.max(0, Math.min(100, (remainGb / totalGb) * 100)) : 0;
                const barCls = pct < 10 ? ' is-empty' : pct < 25 ? ' is-low' : '';
                const nodesCount = p.stat.nodes || 0;
                const rulesetsCount = p.stat.rulesets || 0;

                const card = E('button', {
                    type: 'button',
                    class: 'nk-profile-card' + (draft.profile === p.id ? ' is-selected' : ''),
                    'data-profile': p.id,
                    click: function (ev) {
                        ev.stopPropagation();
                        draft.profile = p.id;
                        profileCardNodes.forEach(function (c) { c.classList.toggle('is-selected', c.dataset.profile === draft.profile); });
                        refreshDirty();
                    }
                }, [
                    E('div', { class: 'nk-profile-top' }, [
                        E('span', { class: 'nk-profile-name' }, p.name),
                        E('span', { class: 'nk-profile-check' }, [ui.svgEl('tick')])
                    ]),
                    E('div', {}, [
                        hasTraffic ? E('div', {}, [
                            E('div', { class: 'nk-profile-traffic-meta' }, [
                                E('span', {}, [_('Remaining') + ' ', E('strong', {}, ui.formatGB(remainGb))]),
                                E('span', {}, ui.formatGB(totalGb))
                            ]),
                            E('div', { class: 'nk-profile-bar' }, [
                                E('div', { class: 'nk-profile-bar-fill' + barCls, style: 'width:' + pct.toFixed(1) + '%;' })
                            ])
                        ]) : (usedGb && usedGb > 0 ? E('div', { class: 'nk-profile-traffic-meta', style: 'margin-bottom:0;' }, [
                            E('span', {}, [_('Used') + ' ', E('strong', {}, ui.formatGB(usedGb))]),
                            E('span', {}, _('Unlimited Traffic'))
                        ]) : E('div', { class: 'nk-field-desc' }, p.type === 'file' ? (_('Local Profile') + (p.size ? ' · ' + ui.formatSize(p.size) : '')) : _('Subscription'))),
                        E('div', { class: 'nk-profile-stats' }, [
                            E('span', {}, [E('strong', {}, String(nodesCount)), ' ' + _('Nodes')]),
                            E('span', {}, '·'),
                            E('span', {}, [E('strong', {}, String(rulesetsCount)), ' ' + _('Rule Sets')])
                        ])
                    ])
                ]);
                profileCardNodes.push(card);
                profileStrip.appendChild(card);
            });
        }

        // Row 2: 4 compact vertical blocks (Fast Reload, Core Only, Scheduled Restart, Start Delay)
        const fastChk = E('input', { type: 'checkbox', class: 'nk-check' });
        const coreOnlyChk = E('input', { type: 'checkbox', class: 'nk-check' });
        const schedChk = E('input', { type: 'checkbox', class: 'nk-check' });
        const cronInput = E('input', { type: 'text', class: 'nk-input nk-mono', placeholder: '0 3 * * *' });
        const cronHint = E('p', { class: 'nk-field-desc' }, _('Restart the core service periodically on the configured Cron schedule'));
        const delayInput = E('input', { type: 'text', class: 'nk-input', placeholder: _('Start Immediately (sec)') });

        fastChk.addEventListener('change', function () { draft.fast_reload = fastChk.checked; refreshDirty(); });
        coreOnlyChk.addEventListener('change', function () { draft.core_only = coreOnlyChk.checked; refreshDirty(); });
        schedChk.addEventListener('change', function () {
            draft.scheduled_restart = schedChk.checked;
            cronInput.classList.toggle('nk-hidden', !schedChk.checked);
            cronHint.classList.toggle('nk-hidden', schedChk.checked);
            refreshDirty();
        });
        cronInput.addEventListener('input', function () { draft.scheduled_restart_cron = cronInput.value; refreshDirty(); });
        delayInput.addEventListener('input', function () { draft.start_delay = delayInput.value; refreshDirty(); });

        const optsGrid = E('div', { class: 'nk-tofu-grid' }, [
            E('div', { class: 'nk-field' }, [
                E('label', { class: 'nk-field-head', style: 'cursor:pointer;' }, [
                    E('span', { class: 'nk-field-title' }, _('Fast Reload')),
                    fastChk
                ]),
                E('p', { class: 'nk-field-desc' }, _('After changing the controller address, API secret, TLS settings, or dashboard download URL, restart the service to apply the changes.'))
            ]),
            E('div', { class: 'nk-field' }, [
                E('label', { class: 'nk-field-head', style: 'cursor:pointer;' }, [
                    E('span', { class: 'nk-field-title' }, _('Core Only')),
                    coreOnlyChk
                ]),
                E('p', { class: 'nk-field-desc' }, _('Run Concord core only without writing transparent proxy firewall rules'))
            ]),
            E('div', { class: 'nk-field' }, [
                E('label', { class: 'nk-field-head', style: 'cursor:pointer;' }, [
                    E('span', { class: 'nk-field-title' }, _('Scheduled Restart')),
                    schedChk
                ]),
                cronInput,
                cronHint
            ]),
            E('div', { class: 'nk-field' }, [
                E('div', { class: 'nk-field-head' }, [
                    E('span', { class: 'nk-field-title' }, _('Start Delay'))
                ]),
                delayInput,
                E('p', { class: 'nk-field-desc' }, _('Wait after boot until network is ready'))
            ])
        ]);

        // Whisper-quiet footer: Versions on left | Active-only status labels on right
        const ipv4On = uci.get('nikkic', 'proxy', 'ipv4_proxy') !== '0';
        const ipv6On = uci.get('nikkic', 'proxy', 'ipv6_proxy') === '1';
        const bypassCn = uci.get('nikkic', 'proxy', 'bypass_china_mainland_ip') === '1';
        const smartMode = stats.active_smart || '';
        const statusLabels = [];
        if (ipv4On && ipv6On) statusLabels.push('IPv4 / IPv6');
        else if (ipv4On) statusLabels.push('IPv4');
        else if (ipv6On) statusLabels.push('IPv6');
        if (smartMode === 'smart-lgbm') statusLabels.push('Smart-LGBM');
        else if (smartMode === 'smart') statusLabels.push('Smart');
        if (bypassCn) statusLabels.push(_('Bypass China Mainland IP'));

        const statusPillsEl = E('div', { class: 'nk-status-pills' }, statusLabels.map(function (t) {
            return E('span', {}, t);
        }));

        const coreVerLabel = ver.core ? (/^concord/i.test(ver.core) ? ver.core : ('Concord ' + ver.core)) : 'Concord';
        const appVerLabel = ver.app ? ('Nikki ' + ver.app) : 'Nikki Concord';
        const footer = E('div', { class: 'nk-card-footer nk-only-open' }, [
            E('div', { class: 'nk-ver-group' }, [
                E('span', {}, coreVerLabel),
                E('span', {}, appVerLabel)
            ]),
            statusPillsEl
        ]);

        // Card 1: Basic Config (expanded by default)
        const cardBasic = E('div', { class: 'nk-deck-card is-open', 'data-card': 'basic' }, [
            E('div', { class: 'nk-deck-head' }, [
                E('div', {}, [
                    E('div', { class: 'nk-deck-title' }, _('Basic Config')),
                    E('div', { class: 'nk-deck-sub' }, _('Profile selection, startup & reload policy'))
                ]),
                masterBtn
            ]),
            E('div', { class: 'nk-deck-body' }, [
                E('div', { class: 'nk-field' }, [
                    E('span', { class: 'nk-field-title' }, _('Choose Profile')),
                    profileStrip
                ]),
                E('div', { class: 'nk-extra-field' }, [optsGrid])
            ]),
            footer,
            E('div', { class: 'nk-card-footer nk-only-closed', style: 'justify-content:flex-end;' }, [
                E('span', { class: 'nk-expand-cue' }, _('Click to expand'))
            ])
        ]);

        // Card 2: Resource Limits (RLIMIT 10 fields — top 3 previewed when collapsed!)
        const rlimitInputs = {};
        const rlimitGrid = E('div', { class: 'nk-rlimit-grid' }, RLIMIT_FIELDS.map(function (f, idx) {
            const inp = E('input', {
                type: 'text',
                class: 'nk-input nk-mono',
                placeholder: typeof f.ph === 'function' ? f.ph() : f.ph
            });
            inp.addEventListener('input', function () { draft[f.key] = inp.value; refreshDirty(); });
            rlimitInputs[f.key] = inp;
            return E('div', { class: 'nk-field' + (idx >= 3 ? ' nk-extra-field' : '') }, [
                E('span', { class: 'nk-field-title' }, f.label()),
                inp
            ]);
        }));

        const cardRlimit = E('div', { class: 'nk-deck-card', 'data-card': 'rlimit' }, [
            E('div', { class: 'nk-deck-head' }, [
                E('div', {}, [
                    E('div', { class: 'nk-deck-title' }, [
                        E('span', {}, _('Resource Limits')),
                        E('span', { class: 'nk-deck-badge' }, _('RLIMIT · 10 items'))
                    ]),
                    E('div', { class: 'nk-deck-sub' }, _('Process descriptors & memory limits (leave blank for unlimited)'))
                ])
            ]),
            E('div', { class: 'nk-deck-body' }, [rlimitGrid]),
            E('div', { class: 'nk-card-footer nk-only-closed', style: 'justify-content:flex-end;' }, [
                E('span', { class: 'nk-expand-cue' }, _('Click to expand'))
            ])
        ]);

        function openDeck(key) {
            cardBasic.classList.toggle('is-open', key === 'basic');
            cardRlimit.classList.toggle('is-open', key === 'rlimit');
        }
        cardBasic.addEventListener('click', function () { if (!cardBasic.classList.contains('is-open')) openDeck('basic'); });
        cardRlimit.addEventListener('click', function () { if (!cardRlimit.classList.contains('is-open')) openDeck('rlimit'); });

        // Upgrade workflow UI inside Hero Feed
        function showUpgradeState(st) {
            if (!st || st.state === 'idle') return;
            const ser = JSON.stringify(st);
            if (ser === previousUpgrade) return;
            previousUpgrade = ser;
            if (st.state === 'running') {
                upgradeActive = true;
                shell.setBusy(_('Upgrading...'), 'var(--sp-cobalt)');
                const pct = phasePercent(st);
                shell.setFeed('upgrade', false, [
                    E('div', { class: 'nk-upg-box' }, [
                        E('div', { class: 'nk-upg-head' }, [
                            E('span', { style: 'color:var(--sp-cobalt);' }, phaseLabel(st)),
                            E('span', { class: 'nk-mono', style: 'color:var(--sp-muted);' }, pct + '%')
                        ]),
                        E('div', { class: 'nk-upg-track' }, [
                            E('div', { class: 'nk-upg-fill', style: 'width:' + pct + '%;' })
                        ])
                    ])
                ]);
                return;
            }
            upgradeActive = false;
            nikkic.status().then(function (s) { shell.endBusy(s); syncRunningUI(s); });
            if (st.state === 'done') {
                const v = st.current || st.latest || '';
                const label = st.phase === 'up_to_date' ? _('Already up to date') : _('Upgrade completed');
                shell.setFeed('upgrade', false, [
                    E('div', { style: 'color:var(--sp-success);font-weight:600;' }, label + (v ? ' (' + v + ')' : '')),
                    E('div', { class: 'nk-feed-actions' }, [
                        E('button', { type: 'button', class: 'nk-btn nk-btn-sm nk-btn-accent', click: function () { window.location.reload(); } }, _('Reload Page')),
                        E('button', { type: 'button', class: 'nk-btn nk-btn-sm', click: function () { previousUpgrade = ''; shell.setFeed('none', false, []); } }, _('Dismiss'))
                    ])
                ]);
                return;
            }
            if (st.state === 'error' || st.ok === false) {
                shell.setFeed('upgrade', false, [
                    E('div', { style: 'color:var(--sp-danger);font-weight:600;' }, _('Upgrade failed') + ': ' + (st.message || st.error || '')),
                    E('div', { class: 'nk-feed-actions' }, [
                        E('button', { type: 'button', class: 'nk-btn nk-btn-sm', click: function () { previousUpgrade = ''; shell.setFeed('none', false, []); } }, _('Dismiss'))
                    ])
                ]);
            }
        }

        function showCheckResult(info) {
            previousUpgrade = '';
            if (!info || !info.ok) {
                shell.setFeed('upgrade', false, [
                    E('div', { style: 'color:var(--sp-danger);font-weight:600;' }, _('Update check failed') + (info && info.error ? ': ' + info.error : '')),
                    E('div', { class: 'nk-feed-actions' }, [
                        E('button', { type: 'button', class: 'nk-btn nk-btn-sm', click: function () { shell.setFeed('none', false, []); } }, _('Dismiss'))
                    ])
                ]);
                return;
            }
            if (!info.has_update) {
                const cur = info.current || ver.app || info.latest || '';
                shell.setFeed('upgrade', false, [
                    E('div', {}, _('Already up to date') + (cur ? ' (' + cur + ')' : '')),
                    E('div', { class: 'nk-feed-actions' }, [
                        E('button', { type: 'button', class: 'nk-btn nk-btn-sm', click: function () { shell.setFeed('none', false, []); } }, _('Dismiss'))
                    ])
                ]);
                return;
            }
            const meta = [info.tag || info.latest, info.arch, ui.formatSize(info.size)].filter(Boolean).join(' · ');
            const actions = [
                E('button', {
                    type: 'button',
                    class: 'nk-btn nk-btn-sm nk-btn-accent',
                    click: function () {
                        upgradeActive = true;
                        previousUpgrade = '';
                        showUpgradeState({ state: 'running', phase: 'starting' });
                        return nikkic.upgradeApp(info.tag).then(function (res) {
                            if (res && res.ok === false) showUpgradeState({ state: 'error', message: res.error || _('Failed to start upgrade') });
                            else showUpgradeState(res);
                        });
                    }
                }, _('Upgrade Now'))
            ];
            if (info.html_url) {
                actions.push(E('a', { class: 'nk-btn nk-btn-sm', href: info.html_url, target: '_blank', rel: 'noopener noreferrer' }, _('View Release')));
            }
            actions.push(E('button', { type: 'button', class: 'nk-btn nk-btn-sm', click: function () { shell.setFeed('none', false, []); } }, _('Dismiss')));
            shell.setFeed('upgrade', false, [
                E('div', {}, [_('Update available') + ' ', E('strong', { style: 'color:var(--sp-text);' }, meta)]),
                E('div', { class: 'nk-feed-actions' }, actions)
            ]);
        }

        // Bottom Action Band (matching preview soft tile pills + solid Morandi blue Open Dashboard)
        const openDashBtn = E('button', {
            type: 'button',
            class: 'nk-tile-btn is-primary',
            click: function () { return nikkic.openDashboard(); }
        }, [E('span', {}, _('Open Dashboard')), ui.svgEl('external')]);

        const bottomBand = E('div', { class: 'nk-bottom-band' }, [
            E('div', { class: 'nk-bottom-left' }, [
                E('button', {
                    type: 'button',
                    class: 'nk-btn nk-btn-ghost nk-btn-sm',
                    click: function () { ui.setClassicMode(true); }
                }, _('Switch to Classic UI')),
                E('span', { class: 'nk-bottom-note' }, _('Running: Save triggers reload · Stopped: Save only'))
            ]),
            E('div', { class: 'nk-bottom-right' }, [
                E('button', {
                    type: 'button',
                    class: 'nk-tile-btn',
                    click: async function () {
                        shell.setBusy(_('Reloading...'), 'var(--sp-cobalt)');
                        try { await nikkic.reload(); } catch (_) {}
                        const ov = await nikkic.overview('');
                        shell.endBusy(ov.status);
                        shell.applyWarnings(ov.warnings);
                        syncRunningUI(ov.status);
                    }
                }, [ui.svgEl('refresh'), E('span', {}, _('Reload Service'))]),
                E('button', {
                    type: 'button',
                    class: 'nk-tile-btn is-danger',
                    click: async function () {
                        shell.setBusy(_('Restarting...'), 'var(--sp-warning)');
                        try { await nikkic.restart(); } catch (_) {}
                        const ov = await nikkic.overview('');
                        shell.endBusy(ov.status);
                        shell.applyWarnings(ov.warnings);
                        syncRunningUI(ov.status);
                    }
                }, [ui.svgEl('power'), E('span', {}, _('Restart Service'))]),
                E('button', {
                    type: 'button',
                    class: 'nk-tile-btn',
                    click: function () {
                        if (upgradeActive) return nikkic.upgradeStatus().then(showUpgradeState);
                        shell.setFeed('upgrade', false, [E('div', {}, _('Checking for updates...'))]);
                        return nikkic.checkUpdate().then(showCheckResult);
                    }
                }, [ui.svgEl('download'), E('span', {}, _('Check Update'))]),
                openDashBtn
            ])
        ]);

        function syncFormUI() {
            profileCardNodes.forEach(function (c) { c.classList.toggle('is-selected', c.dataset.profile === draft.profile); });
            fastChk.checked = !!draft.fast_reload;
            coreOnlyChk.checked = !!draft.core_only;
            schedChk.checked = !!draft.scheduled_restart;
            cronInput.value = draft.scheduled_restart_cron;
            cronInput.classList.toggle('nk-hidden', !draft.scheduled_restart);
            cronHint.classList.toggle('nk-hidden', !!draft.scheduled_restart);
            delayInput.value = draft.start_delay === '0' ? '' : draft.start_delay;
            RLIMIT_FIELDS.forEach(function (f) {
                rlimitInputs[f.key].value = draft[f.key] || '';
            });
        }

        function syncRunningUI(st) {
            const running = !!(st && st.running);
            masterBtn.setEnabled(running, false);
            openDashBtn.disabled = !running;
            statusPillsEl.classList.toggle('nk-hidden', !running || isFresh);
        }

        syncFormUI();
        shell.applyStatus(initStatus);
        syncRunningUI(initStatus);
        shell.applyWarnings(initWarnings);
        if (initUpgrade && initUpgrade.state === 'running') showUpgradeState(initUpgrade);

        ui.attachPolling(function () {
            return nikkic.overview(upgradeActive ? 'u' : '').then(function (r) {
                shell.applyStatus(r.status);
                syncRunningUI(r.status);
                shell.applyWarnings(r.warnings);
                if (r.upgrade) showUpgradeState(r.upgrade);
            });
        }, 5);

        shell.content.appendChild(E('div', { class: 'nk-deck' }, [cardBasic, cardRlimit]));
        shell.content.appendChild(bottomBand);
        return shell.root;
    }
};
if (!ui.isClassicMode()) {
    appSpec.handleSave = null;
    appSpec.handleSaveApply = null;
    appSpec.handleReset = null;
}
return view.extend(appSpec);
