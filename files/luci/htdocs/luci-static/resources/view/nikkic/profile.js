'use strict';
'require view';
'require uci';
'require fs';
'require tools.nikkic as nikkic';
'require tools.nikkic-ui as ui';

const UA_PRESETS = ['clash', 'clash.meta', 'mihomo'];

function isValidHttpUrl(val) {
    try {
        const u = new URL(val);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
        const h = u.hostname || '';
        return h === 'localhost' || h.includes('.') || h.includes(':');
    } catch (_) {
        return false;
    }
}

function sanitizeFileName(name) {
    let base = String(name || '').replace(/^.*[\\/]/, '').replace(/[^A-Za-z0-9._-]/g, '_');
    if (!/\.(ya?ml)$/i.test(base)) base += '.yaml';
    return base;
}

const profileSpec = {
    load: function () {
        if (ui.isClassicMode()) return ui.delegateClassic('profile').load();
        return Promise.all([
            uci.load('nikkic'),
            nikkic.overview('s'),
            nikkic.listProfiles()
        ]);
    },

    render: function (data) {
        if (ui.isClassicMode()) return ui.delegateClassic('profile').render(data);

        const ov = data[1] || {};
        const initStatus = ov.status || {};
        const initWarnings = ov.warnings || {};
        let localFiles = (data[2] || []).filter(function (f) { return f && f.name && /\.(ya?ml)$/i.test(f.name); });
        let statsMap = (ov.stats && ov.stats.files) || {};

        function loadSubsFromUci() {
            return (uci.sections('nikkic', 'subscription') || []).filter(function (s) {
                return !(s['.name'] === 'subscription' && s.url === 'http://example.com/default.yaml');
            }).map(function (s) {
                return {
                    sid: s['.name'],
                    name: s.name || s['.name'],
                    url: s.url || '',
                    user_agent: s.user_agent || 'clash',
                    prefer: s.prefer || 'remote',
                    used: s.used || '',
                    total: s.total || '',
                    expire: s.expire || '',
                    update: s.update || ''
                };
            });
        }

        let subs = loadSubsFromUci();
        let confirmingKey = null;
        let busyKeys = {};
        let statusMsgMap = {};

        const shell = ui.createShell({
            activeTab: 'profile',
            showSave: false
        });
        shell.applyStatus(initStatus);
        shell.applyWarnings(initWarnings);

        ui.attachStatusPoll(shell);

        const countMeta = E('span', { class: 'nk-field-desc' }, '');
        const grid = E('div', { class: 'nk-cfg-grid' });

        async function reloadProfileState() {
            await uci.unload('nikkic');
            await uci.load('nikkic');
            subs = loadSubsFromUci();
            const [files, st] = await Promise.all([
                nikkic.listProfiles(),
                nikkic.profileStats ? nikkic.profileStats() : Promise.resolve({ files: {} })
            ]);
            localFiles = (files || []).filter(function (f) { return f && f.name && /\.(ya?ml)$/i.test(f.name); });
            statsMap = (st && st.files) || {};
            renderGrid();
        }

        async function updateSubNow(sub) {
            const key = 'sub:' + sub.sid;
            if (busyKeys[key]) return;
            busyKeys[key] = true;
            statusMsgMap[key] = { tone: 'loading', text: _('Updating...') };
            renderGrid();
            try {
                const res = await nikkic.updateSubscription(sub.sid);
                if (res && res.success === false) throw new Error(_('Update failed'));
                delete busyKeys[key];
                statusMsgMap[key] = { tone: 'ok', text: _('Update succeeded') };
                await reloadProfileState();
                setTimeout(function () {
                    if (statusMsgMap[key] && statusMsgMap[key].tone === 'ok') {
                        delete statusMsgMap[key];
                        renderGrid();
                    }
                }, 2200);
            } catch (_) {
                delete busyKeys[key];
                statusMsgMap[key] = { tone: 'err', text: _('Update failed, check link') };
                renderGrid();
            }
        }

        function renderGrid() {
            const userLocal = localFiles.filter(function (f) {
                return !(f.name === 'default.yaml' && (f.size || 0) <= 64);
            });
            const totalCount = subs.length + userLocal.length;
            countMeta.textContent = totalCount + ' ' + _('Profiles');
            const nodes = [];

            subs.forEach(function (sub) {
                const key = 'sub:' + sub.sid;
                if (confirmingKey === key) {
                    nodes.push(E('div', { class: 'nk-cfg-card is-confirm-del' }, [
                        E('div', {}, [
                            E('div', { class: 'nk-cfg-del-title' }, _('Delete') + '「' + sub.name + '」？'),
                            E('div', { class: 'nk-cfg-del-desc' }, _('This will remove the subscription from configuration.'))
                        ]),
                        E('div', { class: 'nk-cfg-del-actions' }, [
                            E('button', { type: 'button', class: 'nk-btn', click: function () { confirmingKey = null; renderGrid(); } }, _('Cancel')),
                            E('button', {
                                type: 'button',
                                class: 'nk-btn nk-btn-danger',
                                click: async function () {
                                    confirmingKey = null;
                                    uci.remove('nikkic', sub.sid);
                                    if (uci.get('nikkic', 'config', 'profile') === 'subscription:' + sub.sid)
                                        uci.unset('nikkic', 'config', 'profile');
                                    await ui.commitUci();
                                    await reloadProfileState();
                                }
                            }, _('Delete'))
                        ])
                    ]));
                    return;
                }

                const stat = statsMap['subscription:' + sub.sid] || {};
                const usedGb = ui.parseSizeToGB(sub.used);
                const totalGb = ui.parseSizeToGB(sub.total);
                const hasTraffic = totalGb && totalGb > 0;
                const remainGb = hasTraffic ? Math.max(0, totalGb - (usedGb || 0)) : 0;
                const pct = hasTraffic ? Math.max(0, Math.min(100, (remainGb / totalGb) * 100)) : 0;
                const barCls = pct < 10 ? ' is-empty' : pct < 25 ? ' is-low' : '';
                const stInfo = statusMsgMap[key];
                const subLineText = stInfo ? stInfo.text : (sub.update ? (_('Updated') + ' ' + ui.formatShortStamp(sub.update)) : _('Not updated yet'));
                const subLineCls = 'nk-cfg-sub' + (stInfo ? (' is-' + stInfo.tone) : '');

                nodes.push(E('div', { class: 'nk-cfg-card' }, [
                    E('div', {}, [
                        E('div', { class: 'nk-cfg-top' }, [
                            E('span', { class: 'nk-cfg-name', title: sub.name }, sub.name),
                            E('div', { class: 'nk-cfg-actions' }, [
                                E('button', {
                                    type: 'button',
                                    class: 'nk-icon-btn is-accent' + (busyKeys[key] ? ' is-spinning' : ''),
                                    title: _('Update'),
                                    click: function () { updateSubNow(sub); }
                                }, [ui.svgEl('refresh')]),
                                E('button', {
                                    type: 'button',
                                    class: 'nk-icon-btn',
                                    title: _('Edit'),
                                    click: function () { openModal(sub); }
                                }, [ui.svgEl('edit')]),
                                E('button', {
                                    type: 'button',
                                    class: 'nk-icon-btn is-danger',
                                    title: _('Delete'),
                                    click: function () { confirmingKey = key; renderGrid(); }
                                }, [ui.svgEl('trash')])
                            ])
                        ]),
                        E('span', { class: subLineCls }, subLineText)
                    ]),
                    E('div', {}, [
                        hasTraffic ? E('div', {}, [
                            E('span', { class: 'nk-cfg-sub', style: 'margin-bottom:4px;' },
                                _('Expire') + ' ' + (ui.formatExpireDate(sub.expire) || _('Never'))),
                            E('div', { class: 'nk-profile-traffic-meta' }, [
                                E('span', {}, [_('Remaining') + ' ', E('strong', {}, ui.formatGB(remainGb))]),
                                E('span', {}, ui.formatGB(totalGb))
                            ]),
                            E('div', { class: 'nk-profile-bar' }, [
                                E('div', { class: 'nk-profile-bar-fill' + barCls, style: 'width:' + pct.toFixed(1) + '%;' })
                            ])
                        ]) : E('div', {}, [
                            E('span', { class: 'nk-cfg-sub', style: 'margin-bottom:4px;' },
                                _('Expire') + ' ' + (ui.formatExpireDate(sub.expire) || _('Never'))),
                            usedGb && usedGb > 0 ? E('div', { class: 'nk-profile-traffic-meta', style: 'margin-bottom:0;' }, [
                                E('span', {}, [_('Used') + ' ', E('strong', {}, ui.formatGB(usedGb))]),
                                E('span', {}, _('Unlimited Traffic'))
                            ]) : ''
                        ]),
                        E('div', { class: 'nk-profile-stats' }, [
                            E('span', {}, [E('strong', {}, String(stat.nodes || 0)), ' ' + _('Nodes')]),
                            E('span', {}, '·'),
                            E('span', {}, [E('strong', {}, String(stat.rulesets || 0)), ' ' + _('Rule Sets')])
                        ])
                    ])
                ]));
            });

            userLocal.forEach(function (f) {
                const key = 'file:' + f.name;
                if (confirmingKey === key) {
                    nodes.push(E('div', { class: 'nk-cfg-card is-confirm-del' }, [
                        E('div', {}, [
                            E('div', { class: 'nk-cfg-del-title' }, _('Delete') + '「' + f.name + '」？'),
                            E('div', { class: 'nk-cfg-del-desc' }, _('This will remove this local YAML profile file.'))
                        ]),
                        E('div', { class: 'nk-cfg-del-actions' }, [
                            E('button', { type: 'button', class: 'nk-btn', click: function () { confirmingKey = null; renderGrid(); } }, _('Cancel')),
                            E('button', {
                                type: 'button',
                                class: 'nk-btn nk-btn-danger',
                                click: async function () {
                                    confirmingKey = null;
                                    if (nikkic.deleteProfile) await nikkic.deleteProfile(f.name);
                                    if (uci.get('nikkic', 'config', 'profile') === 'file:' + f.name) {
                                        uci.unset('nikkic', 'config', 'profile');
                                        await ui.commitUci();
                                    }
                                    await reloadProfileState();
                                }
                            }, _('Delete'))
                        ])
                    ]));
                    return;
                }
                const stat = statsMap['file:' + f.name] || {};
                nodes.push(E('div', { class: 'nk-cfg-card' }, [
                    E('div', {}, [
                        E('div', { class: 'nk-cfg-top' }, [
                            E('span', { class: 'nk-cfg-name', title: f.name }, f.name),
                            E('div', { class: 'nk-cfg-actions' }, [
                                E('button', {
                                    type: 'button',
                                    class: 'nk-icon-btn is-accent',
                                    title: _('Download'),
                                    click: async function () {
                                        const text = await L.resolveDefault(fs.read_direct(nikkic.profilesDir + '/' + f.name), '');
                                        ui.downloadFile(f.name, text || '', 'text/yaml;charset=utf-8');
                                    }
                                }, [ui.svgEl('download')]),
                                E('button', {
                                    type: 'button',
                                    class: 'nk-icon-btn is-danger',
                                    title: _('Delete'),
                                    click: function () { confirmingKey = key; renderGrid(); }
                                }, [ui.svgEl('trash')])
                            ])
                        ]),
                        E('span', { class: 'nk-cfg-sub' }, f.mtime ? (_('Uploaded') + ' ' + ui.formatShortStamp(f.mtime)) : _('Local Profile'))
                    ]),
                    E('div', {}, [
                        E('span', { class: 'nk-cfg-sub' }, _('Local Profile') + (f.size ? ' · ' + ui.formatSize(f.size) : '')),
                        E('div', { class: 'nk-profile-stats' }, [
                            E('span', {}, [E('strong', {}, String(stat.nodes || 0)), ' ' + _('Nodes')]),
                            E('span', {}, '·'),
                            E('span', {}, [E('strong', {}, String(stat.rulesets || 0)), ' ' + _('Rule Sets')])
                        ])
                    ])
                ]));
            });

            nodes.push(E('button', {
                type: 'button',
                class: 'nk-cfg-add-card',
                title: _('Add Profile'),
                click: function () { openModal(null); }
            }, [ui.svgEl('plus'), E('span', {}, _('Add Profile'))]));

            grid.replaceChildren(...nodes);
        }

        // Unified Add / Edit Profile Modal (Link Import | Upload .yaml or QR Code)
        let editingSub = null;
        let modalMode = 'url';
        let pendingFile = null;
        let modalBusy = false;

        const mTitle = E('h3', { class: 'nk-modal-title' }, '');
        const mName = E('input', { type: 'text', class: 'nk-input', placeholder: _('e.g. Main Nodes') });
        const mNameErr = E('span', { class: 'nk-field-err' }, '');
        const mUrl = E('input', { type: 'text', class: 'nk-input nk-mono', placeholder: 'https://...' });
        const mUrlErr = E('span', { class: 'nk-field-err' }, '');
        const mUa = ui.createCombo({ value: 'clash', placeholder: 'clash', options: UA_PRESETS });
        const mPrefer = ui.createSegmented({
            value: 'remote',
            options: [{ value: 'remote', label: _('Remote') }, { value: 'local', label: _('Local') }]
        });
        const mAdvArrow = E('span', {}, '▸');
        const mAdvBox = E('div', { class: 'nk-hidden', style: 'display:flex;flex-direction:column;gap:11px;padding-top:6px;' }, [
            E('div', { class: 'nk-field' }, [E('span', { class: 'nk-field-title' }, _('User Agent')), mUa]),
            E('div', { class: 'nk-field' }, [E('span', { class: 'nk-field-title' }, _('Prefer')), mPrefer])
        ]);

        const mFileInput = E('input', { type: 'file', accept: '.yaml,.yml,image/*', class: 'nk-hidden' });
        const mUploadLabel = E('div', { style: 'font-size:13px;font-weight:600;' }, _('Select local .yaml or QR code image'));
        const mUploadSub = E('div', { class: 'nk-field-desc', style: 'margin-top:4px;' }, _('Supports .yaml files or QR screenshots (decoded offline in browser)'));
        const mUploadZone = E('div', {
            class: 'nk-upload-zone',
            click: function () { mFileInput.click(); }
        }, [mUploadLabel, mUploadSub, mFileInput]);

        const mUrlBox = E('div', { style: 'display:flex;flex-direction:column;gap:12px;' }, [
            E('div', { class: 'nk-field' }, [E('span', { class: 'nk-field-title' }, _('Profile Name')), mName, mNameErr]),
            E('div', { class: 'nk-field' }, [E('span', { class: 'nk-field-title' }, _('Subscription Url')), mUrl, mUrlErr]),
            E('div', {}, [
                E('button', {
                    type: 'button',
                    class: 'nk-btn nk-btn-sm nk-btn-ghost',
                    click: function () {
                        const hidden = mAdvBox.classList.toggle('nk-hidden');
                        mAdvArrow.textContent = hidden ? '▸' : '▾';
                    }
                }, [mAdvArrow, ' ' + _('Advanced Options')]),
                mAdvBox
            ])
        ]);

        const mModeSeg = ui.createSegmented({
            value: 'url',
            wide: true,
            options: [{ value: 'url', label: _('Import URL') }, { value: 'upload', label: _('Upload File') }],
            onChange: function (v) { setMode(v); }
        });
        const mModeWrap = E('div', { style: 'display:flex;justify-content:center;' }, [mModeSeg]);

        const mStatus = E('div', { class: 'nk-modal-status' });
        const mSaveBtn = E('button', { type: 'button', class: 'nk-btn nk-btn-primary' }, _('Save'));
        const mCancelBtn = E('button', { type: 'button', class: 'nk-btn' }, _('Cancel'));
        const mCloseBtn = E('button', { type: 'button', class: 'nk-icon-btn', title: _('Close') }, [ui.svgEl('close')]);

        const modalBackdrop = E('div', { class: 'nk-modal-backdrop nk-hidden' }, [
            E('div', { class: 'nk-modal' }, [
                E('div', { class: 'nk-modal-head' }, [mTitle, mCloseBtn]),
                E('div', { class: 'nk-modal-body' }, [mModeWrap, mUrlBox, mUploadZone, mStatus]),
                E('div', { class: 'nk-modal-foot' }, [mCancelBtn, mSaveBtn])
            ])
        ]);

        function setMode(mode) {
            modalMode = mode === 'upload' ? 'upload' : 'url';
            mModeSeg.setValue(modalMode);
            mUrlBox.classList.toggle('nk-hidden', modalMode !== 'url');
            mUploadZone.classList.toggle('nk-hidden', modalMode !== 'upload');
        }

        function setFieldErr(inp, errEl, msg) {
            inp.classList.toggle('is-invalid', !!msg);
            errEl.textContent = msg || '';
            errEl.classList.toggle('is-show', !!msg);
        }

        function setModalStatus(tone, msg) {
            mStatus.className = 'nk-modal-status' + (tone ? (' is-show is-' + tone) : '');
            if (!tone) { mStatus.replaceChildren(); return; }
            mStatus.replaceChildren(
                tone === 'loading' ? E('span', { class: 'nk-spinner' }) : '',
                E('span', {}, msg)
            );
        }

        function setBusy(busy) {
            modalBusy = busy;
            mSaveBtn.disabled = busy;
            mCancelBtn.disabled = busy;
        }

        mName.addEventListener('input', function () { setFieldErr(mName, mNameErr, ''); });
        mUrl.addEventListener('input', function () { setFieldErr(mUrl, mUrlErr, ''); });

        mFileInput.addEventListener('change', async function () {
            const file = mFileInput.files && mFileInput.files[0];
            if (!file) return;
            if (file.type && file.type.startsWith('image/')) {
                mUploadLabel.textContent = _('Scanning QR code...');
                mUploadSub.textContent = _('Decoding locally in your browser...');
                try {
                    const qr = await L.require('tools.nikkic-qr');
                    const raw = await qr.decodeFile(file);
                    if (!raw) {
                        mUploadLabel.textContent = _('No QR code detected in image');
                        mUploadSub.textContent = _('Try a clearer screenshot containing the full QR code');
                        return;
                    }
                    const parsed = qr.parseQrPayload(raw);
                    if (!parsed) {
                        mUploadLabel.textContent = _('QR code does not contain a valid subscription URL');
                        mUploadSub.textContent = raw.slice(0, 80);
                        return;
                    }
                    setMode('url');
                    mUrl.value = parsed.url;
                    if (parsed.name && !mName.value.trim()) mName.value = parsed.name;
                    setModalStatus('ok', _('QR code decoded'));
                    mName.focus();
                } catch (_) {
                    mUploadLabel.textContent = _('QR decode failed');
                    mUploadSub.textContent = _('Please try another image or paste the URL directly');
                }
                return;
            }
            pendingFile = file;
            mUploadLabel.textContent = _('Selected:') + ' ' + file.name + ' (' + ui.formatSize(file.size) + ')';
            mUploadSub.textContent = _('Click Save to upload this YAML profile');
        });

        function openModal(sub) {
            editingSub = sub || null;
            pendingFile = null;
            mFileInput.value = '';
            mUploadLabel.textContent = _('Select local .yaml or QR code image');
            mUploadSub.textContent = _('Supports .yaml files or QR screenshots (decoded offline in browser)');
            mTitle.textContent = sub ? _('Edit Profile') : _('Add Profile');
            mModeWrap.classList.toggle('nk-hidden', !!sub);
            setMode('url');
            mName.value = sub ? sub.name : '';
            mUrl.value = sub ? sub.url : '';
            mUa.setValue(sub ? sub.user_agent : 'clash');
            mPrefer.setValue(sub ? sub.prefer : 'remote');
            mAdvBox.classList.add('nk-hidden');
            mAdvArrow.textContent = '▸';
            setFieldErr(mName, mNameErr, '');
            setFieldErr(mUrl, mUrlErr, '');
            setModalStatus('', '');
            setBusy(false);
            modalBackdrop.classList.remove('nk-hidden');
            setTimeout(function () { mName.focus(); }, 30);
        }

        function closeModal() {
            if (modalBusy) return;
            modalBackdrop.classList.add('nk-hidden');
        }
        mCloseBtn.addEventListener('click', closeModal);
        mCancelBtn.addEventListener('click', closeModal);
        modalBackdrop.addEventListener('click', function (ev) { if (ev.target === modalBackdrop) closeModal(); });

        mSaveBtn.addEventListener('click', async function () {
            if (modalBusy) return;
            setModalStatus('', '');
            if (!editingSub && modalMode === 'upload') {
                if (!pendingFile) { mFileInput.click(); return; }
                setBusy(true);
                setModalStatus('loading', _('Uploading YAML profile...'));
                try {
                    const text = await pendingFile.text();
                    const fname = sanitizeFileName(pendingFile.name);
                    await nikkic.writefile(nikkic.profilesDir + '/' + fname, text);
                    if (!uci.get('nikkic', 'config', 'profile') || uci.get('nikkic', 'config', 'profile') === 'subscription:subscription') {
                        uci.set('nikkic', 'config', 'profile', 'file:' + fname);
                        await ui.commitUci();
                    }
                    setModalStatus('ok', _('Upload succeeded'));
                    await reloadProfileState();
                    setBusy(false);
                    setTimeout(closeModal, 450);
                } catch (err) {
                    setBusy(false);
                    setModalStatus('err', _('Upload failed') + ': ' + (err && err.message ? err.message : err));
                }
                return;
            }

            const name = mName.value.trim();
            const url = mUrl.value.trim();
            let valid = true;
            if (!name) { setFieldErr(mName, mNameErr, _('Please enter a profile name')); valid = false; }
            if (!url) { setFieldErr(mUrl, mUrlErr, _('Please enter a subscription URL')); valid = false; }
            else if (!isValidHttpUrl(url)) { setFieldErr(mUrl, mUrlErr, _('Please enter a valid http:// or https:// URL')); valid = false; }
            if (!valid) { (!name ? mName : mUrl).focus(); return; }

            setBusy(true);
            setModalStatus('loading', editingSub ? _('Saving profile...') : _('Fetching remote profile...'));
            try {
                let sid;
                if (editingSub) {
                    sid = editingSub.sid;
                } else {
                    sid = uci.add('nikkic', 'subscription');
                }
                uci.set('nikkic', sid, 'name', name);
                uci.set('nikkic', sid, 'url', url);
                uci.set('nikkic', sid, 'user_agent', mUa.getValue().trim() || 'clash');
                uci.set('nikkic', sid, 'prefer', mPrefer.getValue() || 'remote');
                const curProf = uci.get('nikkic', 'config', 'profile');
                if (!curProf || curProf === 'subscription:subscription') {
                    uci.set('nikkic', 'config', 'profile', 'subscription:' + sid);
                }
                await ui.commitUci();

                if (!editingSub) {
                    const res = await nikkic.updateSubscription(sid);
                    if (res && res.success === false) {
                        setBusy(false);
                        setModalStatus('err', _('Saved, but initial fetch failed. Please check the URL.'));
                        await reloadProfileState();
                        return;
                    }
                }
                setModalStatus('ok', editingSub ? _('Saved') : _('Profile imported'));
                await reloadProfileState();
                setBusy(false);
                setTimeout(closeModal, 500);
            } catch (err) {
                setBusy(false);
                setModalStatus('err', _('Failed') + ': ' + (err && err.message ? err.message : err));
            }
        });

        renderGrid();
        shell.content.appendChild(E('div', { class: 'nk-subtabs-row' }, [
            E('div', { class: 'nk-deck-title' }, _('Profile Management')),
            countMeta
        ]));
        shell.content.appendChild(E('div', { class: 'nk-card' }, [grid]));
        shell.root.appendChild(modalBackdrop);
        return shell.root;
    }
};
if (!ui.isClassicMode()) {
    profileSpec.handleSave = null;
    profileSpec.handleSaveApply = null;
    profileSpec.handleReset = null;
}
return view.extend(profileSpec);
