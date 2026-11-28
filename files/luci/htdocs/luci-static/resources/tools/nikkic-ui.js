'use strict';
'require baseclass';
'require poll';
'require uci';
'require ui as luciUi';
'require tools.nikkic as nikkic';

const CLASSIC_KEY = 'nikkic_ui_mode';
const MUTE_KEY = 'nikkic_alert_mute_v1';

const ICONS = {
    check: '<svg class="icon-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    stop: '<svg class="icon-stop" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2.4"/></svg>',
    sleep: '<svg class="icon-sleep" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M2.2 16.6h3.4l-3.4 3.4h3.4" stroke-width="1.7"/><path d="M8.2 10.4h4.4l-4.4 4.4h4.4" stroke-width="1.9"/><path d="M15.4 3.4h6l-6 6h6" stroke-width="2.1"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>',
    power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    tick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>'
};

const TABS = [
    { id: 'config', view: 'app', path: 'admin/services/nikkic/config', label: () => _('App Config') },
    { id: 'profile', view: 'profile', path: 'admin/services/nikkic/profile', label: () => _('Profile') },
    { id: 'mixin', view: 'mixin', path: 'admin/services/nikkic/mixin', label: () => _('Mixin Config') },
    { id: 'proxy', view: 'proxy', path: 'admin/services/nikkic/proxy', label: () => _('Proxy Config') },
    { id: 'editor', view: 'editor', path: 'admin/services/nikkic/editor', label: () => _('Editor') },
    { id: 'log', view: 'log', path: 'admin/services/nikkic/log', label: () => _('Log') }
];

let activeRoot = null;
let activeContent = null;
let activeTabId = '';
let navToken = 0;
let popstateBound = false;
let pollRegistered = false;
let activePollFn = null;
let lastKnownStatus = null;
let lastKnownWarnings = null;

function svgEl(name) {
    const span = E('span', { style: 'display:inline-flex;align-items:center;justify-content:center;' });
    span.innerHTML = ICONS[name] || '';
    return span.firstChild || span;
}

function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
}

function loadMutes() {
    try {
        return JSON.parse(localStorage.getItem(MUTE_KEY) || '{}') || {};
    } catch (_) {
        return {};
    }
}

function saveMute(sig, mode) {
    try {
        const mutes = loadMutes();
        mutes[sig] = mode === 'forever' ? -1 : Date.now() + 86400000;
        localStorage.setItem(MUTE_KEY, JSON.stringify(mutes));
    } catch (_) {}
}

function isMuted(sig) {
    const mutes = loadMutes();
    const until = mutes[sig];
    if (until === -1) return true;
    return typeof until === 'number' && until > Date.now();
}

const CSS_VER = '__NK_CSS_VER__';

function ensureStyles() {
    if (typeof document === 'undefined' || !document.head || !document.getElementById) return;
    if (!document.getElementById('nk-boot-hide')) {
        const st = document.createElement('style');
        st.id = 'nk-boot-hide';
        st.textContent = '.nk-hide-cbi-actions #tabmenu,.nk-hide-cbi-actions #maincontent>ul.tabs,.nk-hide-cbi-actions .cbi-page-actions{display:none!important}';
        document.head.appendChild(st);
    }
    if (document.body) document.body.classList.add('nk-hide-cbi-actions');
    if (!document.getElementById('nk-modern-css')) {
        const link = document.createElement('link');
        link.id = 'nk-modern-css';
        link.rel = 'stylesheet';
        const base = (typeof L !== 'undefined' && L.resource) ? L.resource('nikkic/nikkic.css') : '/luci-static/resources/nikkic/nikkic.css';
        link.href = base + (base.includes('?') ? '&' : '?') + 'nk=' + CSS_VER;
        document.head.appendChild(link);
    }
}

function tabHref(tab) {
    return (typeof L !== 'undefined' && L.url) ? L.url(tab.path) : ('/cgi-bin/luci/' + tab.path);
}

async function navigateTo(tabId, pushHistory) {
    const tab = TABS.find(function (t) { return t.id === tabId; });
    if (!tab) return;
    const href = tabHref(tab);
    if (!activeRoot || !activeRoot.parentNode || isClassicMode() || typeof L === 'undefined' || !L.require) {
        if (typeof window !== 'undefined' && window.location) window.location.href = href;
        return;
    }
    if (tab.id === activeTabId) return;
    const token = ++navToken;
    activeRoot.querySelectorAll('.nk-nav-tab').forEach(function (a) {
        a.classList.toggle('is-active', a.dataset.tab === tab.id);
    });
    if (activeContent) {
        activeContent.style.transition = 'opacity 0.12s ease';
        activeContent.style.opacity = '0.52';
    }
    if (pushHistory !== false && typeof history !== 'undefined' && history.pushState) {
        try { history.pushState({ nkTab: tab.id }, '', href); } catch (_) {}
    }
    const prevRoot = activeRoot;
    try {
        const mod = await L.require('view.nikkic.' + tab.view);
        const data = mod.load ? await mod.load() : null;
        if (token !== navToken) return;
        const nextRoot = await mod.render(data);
        if (token !== navToken) return;
        if (prevRoot && prevRoot.parentNode && nextRoot) {
            prevRoot.replaceWith(nextRoot);
            activeRoot = nextRoot;
        }
    } catch (_) {
        if (token === navToken && typeof window !== 'undefined' && window.location)
            window.location.href = href;
    }
}

function bindPopstate() {
    if (popstateBound || typeof window === 'undefined') return;
    popstateBound = true;
    window.addEventListener('popstate', function () {
        if (isClassicMode()) return;
        const path = (window.location && window.location.pathname) || '';
        const hit = TABS.find(function (t) { return path.endsWith('/' + t.id); });
        if (hit && hit.id !== activeTabId) navigateTo(hit.id, false);
    });
    if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('click', function (ev) {
            if (isClassicMode() || !activeRoot || !activeRoot.parentNode) return;
            if (ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
            const a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
            if (!a || (activeRoot.contains && activeRoot.contains(a))) return;
            const href = a.getAttribute('href') || '';
            const m = href.match(/\/admin\/services\/nikkic(?:\/(config|profile|mixin|proxy|editor|log))?\/?(?:[?#].*)?$/);
            if (!m) return;
            ev.preventDefault();
            if (a.blur) a.blur();
            const openMenu = a.closest && a.closest('.dropdown.open');
            if (openMenu && openMenu.classList) openMenu.classList.remove('open');
            navigateTo(m[1] || 'config', true);
        });
    }
}

function isClassicMode() {
    try {
        return !(typeof localStorage !== 'undefined' && localStorage.getItem(CLASSIC_KEY) === 'modern');
    } catch (_) {
        return true;
    }
}

if (!isClassicMode()) ensureStyles();

function setClassicMode(classic) {
    try {
        if (classic) localStorage.removeItem(CLASSIC_KEY);
        else localStorage.setItem(CLASSIC_KEY, 'modern');
    } catch (_) {}
    if (typeof window !== 'undefined' && window.location && window.location.reload)
        window.location.reload();
}

function makeClassicModernBtn() {
    const btn = E('button', {
        type: 'button',
        class: 'nk-classic-modern-btn',
        style: 'appearance:none;-webkit-appearance:none;background:transparent;background-image:none;border:1px solid rgba(128,128,128,0.28);border-radius:4px;padding:1px 8px;font-size:12px;line-height:1.6;color:inherit;opacity:0.58;cursor:pointer;font-weight:400;box-shadow:none;min-height:0;height:auto;width:auto;margin:0;transition:opacity .15s ease,border-color .15s ease;',
        click: function () { setClassicMode(false); }
    }, _('Modern UI'));
    if (btn && btn.addEventListener) {
        btn.addEventListener('mouseenter', function () {
            btn.style.opacity = '0.95';
            btn.style.borderColor = 'rgba(128,128,128,0.5)';
        });
        btn.addEventListener('mouseleave', function () {
            btn.style.opacity = '0.58';
            btn.style.borderColor = 'rgba(128,128,128,0.28)';
        });
    }
    return btn;
}

function injectClassicSwitch(nodes) {
    const list = Array.isArray(nodes) ? nodes : [nodes];
    for (let i = 0; i < list.length; i++) {
        const el = list[i];
        if (!el || typeof el.querySelector !== 'function') continue;
        const descr = (el.matches && el.matches('.cbi-map-descr')) ? el : el.querySelector('.cbi-map-descr');
        if (descr) {
            const left = E('span', {}, Array.from(descr.childNodes || []));
            descr.style.display = 'flex';
            descr.style.alignItems = 'center';
            descr.style.justifyContent = 'space-between';
            descr.style.flexWrap = 'wrap';
            descr.style.gap = '6px 12px';
            descr.replaceChildren(left, makeClassicModernBtn());
            return true;
        }
    }
    return false;
}

function delegateClassic(viewName) {
    return {
        load: function () {
            return L.require('view.nikkic.classic.' + viewName).then(function (mod) {
                return Promise.resolve(mod.load ? mod.load() : null).then(function (data) {
                    return { mod: mod, data: data };
                });
            });
        },
        render: function (ctx) {
            if (typeof document !== 'undefined' && document.body)
                document.body.classList.remove('nk-hide-cbi-actions');
            return Promise.resolve(ctx.mod.render(ctx.data)).then(function (nodes) {
                if (viewName === 'app') injectClassicSwitch(nodes);
                return nodes;
            });
        }
    };
}

async function copyText(text, btn, defaultLabel) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            throw new Error('fallback');
        }
    } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (_e) {}
        document.body.removeChild(ta);
    }
    if (btn) {
        const prev = defaultLabel || btn.textContent;
        if (btn.classList.contains('nk-btn')) {
            btn.textContent = _('Copied');
            setTimeout(function () { btn.textContent = prev; }, 1400);
        } else {
            const pt = btn.title;
            btn.title = _('Copied');
            btn.style.color = 'var(--sp-success)';
            setTimeout(function () { btn.title = pt; btn.style.color = ''; }, 1400);
        }
    }
}

function downloadFile(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function createEnableBtn(opts) {
    const btn = E('button', {
        type: 'button',
        class: 'nk-enable-btn' + (opts.size === 'sm' ? ' is-sm' : '') + (opts.enabled ? ' is-enabled' : ''),
        'aria-pressed': String(!!opts.enabled),
        title: opts.enabled ? _('Enabled (click to disable)') : _('Disabled (click to enable)')
    });
    btn.innerHTML = ICONS.check + ICONS.stop + ICONS.sleep;
    btn.setEnabled = function (v, suppressHover) {
        btn.classList.toggle('is-enabled', !!v);
        btn.setAttribute('aria-pressed', String(!!v));
        btn.title = v ? _('Enabled (click to disable)') : _('Disabled (click to enable)');
        if (suppressHover) {
            btn.classList.add('just-toggled');
            btn.blur();
        }
    };
    btn.addEventListener('mouseleave', function () { btn.classList.remove('just-toggled'); });
    if (opts.onClick) btn.addEventListener('click', opts.onClick);
    return btn;
}

function createSegmented(opts) {
    let current = String(opts.value ?? '');
    const wrap = E('div', { class: 'nk-seg' + (opts.wide ? ' is-wide' : '') });
    const buttons = [];
    for (const item of opts.options) {
        const val = String(item.value);
        const btn = E('button', {
            type: 'button',
            class: 'nk-seg-btn' + (val === current ? ' is-active' : ''),
            'data-val': val
        }, item.label);
        btn.addEventListener('click', function () {
            if (current === val) return;
            current = val;
            buttons.forEach(function (b) { b.classList.toggle('is-active', b.dataset.val === current); });
            if (opts.onChange) opts.onChange(current);
        });
        buttons.push(btn);
        wrap.appendChild(btn);
    }
    wrap.setValue = function (v) {
        current = String(v ?? '');
        buttons.forEach(function (b) { b.classList.toggle('is-active', b.dataset.val === current); });
    };
    wrap.getValue = function () { return current; };
    return wrap;
}

let comboGlobalBound = false;
function bindComboDismiss() {
    if (comboGlobalBound || typeof document === 'undefined') return;
    comboGlobalBound = true;
    document.addEventListener('click', function (e) {
        if (!e.target.closest('.nk-combo')) {
            document.querySelectorAll('.nk-combo.is-open').forEach(function (c) { c.classList.remove('is-open'); });
        }
    });
}

function createCombo(opts) {
    bindComboDismiss();
    const wrap = E('div', { class: 'nk-combo' });
    const input = E('input', {
        type: 'text',
        class: 'nk-input' + (opts.mono ? ' nk-mono' : ''),
        value: opts.value ?? '',
        placeholder: opts.placeholder || ''
    });
    const toggleBtn = E('button', {
        type: 'button',
        class: 'nk-combo-btn',
        title: _('Choose preset')
    }, [svgEl('chevron')]);
    const menu = E('div', { class: 'nk-combo-menu' });

    function renderMenu() {
        const cur = input.value.trim();
        menu.replaceChildren(...(opts.options || []).map(function (opt) {
            const val = typeof opt === 'string' ? opt : opt.value;
            const label = typeof opt === 'string' ? opt : (opt.label || opt.value);
            const sel = cur === val;
            const showVal = label !== val;
            const item = E('button', {
                type: 'button',
                class: 'nk-combo-opt' + (sel ? ' is-selected' : '')
            }, [
                E('span', { class: 'nk-combo-opt-label' }, [
                    E('span', {}, label),
                    sel ? E('span', {}, '✓') : ''
                ]),
                showVal ? E('span', { class: 'nk-combo-opt-val nk-mono' }, val) : ''
            ]);
            item.addEventListener('click', function (ev) {
                ev.stopPropagation();
                input.value = val;
                wrap.classList.remove('is-open');
                if (opts.onChange) opts.onChange(val);
            });
            return item;
        }));
    }

    toggleBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        const wasOpen = wrap.classList.contains('is-open');
        document.querySelectorAll('.nk-combo.is-open').forEach(function (c) { c.classList.remove('is-open'); });
        if (!wasOpen) {
            renderMenu();
            wrap.classList.add('is-open');
        }
    });
    input.addEventListener('input', function () {
        if (opts.onChange) opts.onChange(input.value);
    });
    wrap.appendChild(input);
    wrap.appendChild(toggleBtn);
    wrap.appendChild(menu);
    wrap.input = input;
    wrap.setValue = function (v) { input.value = v ?? ''; };
    wrap.getValue = function () { return input.value; };
    return wrap;
}

function createChipBox(opts) {
    let items = Array.isArray(opts.values) ? opts.values.filter(Boolean).map(String) : [];
    const isRow = opts.variant === 'row';
    const box = E('div', { class: isRow ? 'nk-chip-row' : 'nk-multi-box' });
    const input = E('input', {
        type: 'text',
        class: isRow ? 'nk-chip-add-input' : 'nk-multi-input',
        placeholder: opts.placeholder || _('Press Enter to add')
    });
    let datalistId = '';
    if (opts.suggestions && opts.suggestions.length) {
        datalistId = 'nk-dl-' + Math.random().toString(36).slice(2, 8);
        const dl = E('datalist', { id: datalistId }, opts.suggestions.map(function (s) {
            return typeof s === 'string' ? E('option', { value: s }) : E('option', { value: s.value }, s.label || s.value);
        }));
        box.appendChild(dl);
        input.setAttribute('list', datalistId);
    }

    function notify() {
        if (opts.onChange) opts.onChange(items.slice());
    }

    function renderChips() {
        box.querySelectorAll('.nk-chip').forEach(function (c) { c.remove(); });
        items.forEach(function (val, idx) {
            const del = E('button', { type: 'button', title: _('Remove') }, '×');
            del.addEventListener('click', function (ev) {
                ev.stopPropagation();
                items.splice(idx, 1);
                renderChips();
                notify();
            });
            const chip = E('span', { class: 'nk-chip' }, [val + ' ', del]);
            box.insertBefore(chip, input);
        });
    }

    function commitInput() {
        const raw = input.value.trim();
        if (!raw) return;
        if (!items.includes(raw)) {
            items.push(raw);
            renderChips();
            notify();
        }
        input.value = '';
    }

    input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            commitInput();
        } else if (ev.key === 'Backspace' && !input.value && items.length) {
            items.pop();
            renderChips();
            notify();
        }
    });
    input.addEventListener('blur', commitInput);
    box.addEventListener('click', function (ev) {
        if (ev.target === box) input.focus();
    });
    box.appendChild(input);
    renderChips();

    box.getValues = function () { return items.slice(); };
    box.setValues = function (arr) {
        items = Array.isArray(arr) ? arr.filter(Boolean).map(String) : [];
        renderChips();
    };
    return box;
}

function createOverwriteCard(opts) {
    let enabled = !!opts.enabled;
    const bodyWrap = E('div', { class: 'nk-ow-body' + (enabled ? '' : ' nk-hidden') }, opts.body || []);
    const btn = createEnableBtn({
        size: 'sm',
        enabled: enabled,
        onClick: function (ev) {
            ev.stopPropagation();
            enabled = !enabled;
            btn.setEnabled(enabled, true);
            card.classList.toggle('is-expanded', enabled);
            bodyWrap.classList.toggle('nk-hidden', !enabled);
            if (enabled && card.scrollIntoView) {
                requestAnimationFrame(function () {
                    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                });
            }
            if (opts.onToggle) opts.onToggle(enabled);
        }
    });
    const head = E('div', { class: 'nk-ow-head' }, [
        E('div', { style: 'min-width:0;' }, [
            E('div', { class: 'nk-field-title' }, opts.title),
            opts.desc ? E('p', { class: 'nk-field-desc' }, opts.desc) : ''
        ]),
        btn
    ]);
    const card = E('div', {
        class: 'nk-ow-card' + (opts.wideOpen ? ' is-wide-open' : '') + (enabled ? ' is-expanded' : '')
    }, [head, bodyWrap]);

    card.setEnabled = function (v) {
        enabled = !!v;
        btn.setEnabled(enabled, false);
        card.classList.toggle('is-expanded', enabled);
        bodyWrap.classList.toggle('nk-hidden', !enabled);
    };
    card.getEnabled = function () { return enabled; };
    card.bodyWrap = bodyWrap;
    return card;
}

function createPasswordInput(opts) {
    let shown = false;
    const inp = E('input', {
        type: 'password',
        class: 'nk-input' + (opts.mono ? ' nk-mono' : ''),
        value: opts.value ?? '',
        placeholder: opts.placeholder || ''
    });
    const toggleBtn = E('button', {
        type: 'button',
        class: 'nk-pw-btn',
        'aria-pressed': 'false',
        'aria-label': _('Show Password'),
        title: _('Show Password')
    }, [svgEl('eye')]);
    toggleBtn.addEventListener('click', function () {
        shown = !shown;
        inp.type = shown ? 'text' : 'password';
        toggleBtn.setAttribute('aria-pressed', String(shown));
        const lbl = shown ? _('Hide Password') : _('Show Password');
        toggleBtn.setAttribute('aria-label', lbl);
        toggleBtn.title = lbl;
        toggleBtn.replaceChildren(svgEl(shown ? 'eyeOff' : 'eye'));
    });
    inp.addEventListener('input', function () {
        if (opts.onInput) opts.onInput(inp.value);
    });
    const wrap = E('div', { class: 'nk-pw' }, [inp, toggleBtn]);
    wrap.input = inp;
    wrap.setValue = function (v) { inp.value = v ?? ''; };
    wrap.getValue = function () { return inp.value; };
    return wrap;
}

// Schema-driven field renderer for compact, zero-duplication forms
function renderFieldGrid(fields, ctx) {
    const grid = E('div', { class: ctx.gridClass || 'nk-mixin-grid' });
    const controls = {};
    for (const f of fields) {
        const val = ctx.get(f);
        const spanCls = f.span === 2 ? ' nk-span-2' : f.span === 3 ? ' nk-span-3' : '';
        let ctrl;
        if (f.type === 'seg') {
            ctrl = createSegmented({
                options: f.options,
                value: val,
                wide: f.wide,
                onChange: function (v) { ctx.set(f, v); }
            });
        } else if (f.type === 'select') {
            const sel = E('select', { class: 'nk-input' }, (f.options || []).map(function (o) {
                const ov = typeof o === 'string' ? o : o.value;
                const ol = typeof o === 'string' ? o : o.label;
                return E('option', { value: ov, selected: String(val) === String(ov) ? '' : null }, ol);
            }));
            sel.addEventListener('change', function () { ctx.set(f, sel.value); });
            sel.setValue = function (v) { sel.value = v ?? ''; };
            ctrl = sel;
        } else if (f.type === 'combo') {
            ctrl = createCombo({
                value: val,
                placeholder: f.placeholder,
                mono: f.mono,
                options: f.options,
                onChange: function (v) { ctx.set(f, v); }
            });
        } else if (f.type === 'readonly') {
            ctrl = E('input', {
                type: 'text',
                class: 'nk-input',
                value: f.displayValue || val || '',
                readonly: ''
            });
            ctrl.setValue = function () {};
        } else if (f.type === 'chips') {
            ctrl = createChipBox({
                values: val,
                placeholder: f.placeholder,
                suggestions: f.suggestions,
                onChange: function (v) { ctx.set(f, v); }
            });
            ctrl.setValue = ctrl.setValues;
        } else if (f.type === 'password') {
            ctrl = createPasswordInput({
                value: val ?? '',
                placeholder: f.placeholder || '',
                mono: f.mono,
                onInput: function (v) { ctx.set(f, v); }
            });
        } else {
            const inp = E('input', {
                type: 'text',
                class: 'nk-input' + (f.mono ? ' nk-mono' : ''),
                value: val ?? '',
                placeholder: f.placeholder || ''
            });
            inp.addEventListener('input', function () { ctx.set(f, inp.value); });
            inp.setValue = function (v) { inp.value = v ?? ''; };
            ctrl = inp;
        }
        controls[f.key] = ctrl;
        grid.appendChild(E('div', { class: 'nk-field' + spanCls }, [
            E('span', { class: 'nk-field-title' }, f.label),
            ctrl,
            f.desc ? E('p', { class: 'nk-field-desc' }, f.desc) : ''
        ]));
    }
    grid.controls = controls;
    return grid;
}

function formatSize(bytes) {
    const n = Number(bytes);
    if (!(n > 0)) return '';
    if (n >= 1048576) return (n / 1048576).toFixed(2) + ' MiB';
    if (n >= 1024) return (n / 1024).toFixed(1) + ' KiB';
    return n + ' B';
}

function parseSizeToGB(raw) {
    if (raw == null || raw === '') return null;
    const s = String(raw).trim();
    const m = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?i?B)?$/i);
    if (!m) return null;
    const v = parseFloat(m[1]);
    const u = (m[2] || '').toUpperCase();
    if (u.startsWith('T')) return v * 1024;
    if (u.startsWith('G')) return v;
    if (u.startsWith('M')) return v / 1024;
    if (u.startsWith('K')) return v / (1024 * 1024);
    if (v > 1048576) return v / (1024 * 1024 * 1024);
    return v;
}

function formatGB(gb) {
    if (gb == null || isNaN(gb)) return '0 GB';
    if (gb >= 1024) return (gb / 1024).toFixed(2) + ' TB';
    return (gb >= 100 ? gb.toFixed(0) : gb.toFixed(1)) + ' GB';
}

function formatShortStamp(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    const m = s.match(/(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}:\d{2})/);
    if (m) return m[2] + '-' + m[3] + ' ' + m[4];
    const num = Number(s);
    if (num > 1000000000) {
        const d = new Date(num * (num < 10000000000 ? 1000 : 1));
        const p = function (n) { return String(n).padStart(2, '0'); };
        return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    return s;
}

function formatExpireDate(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    if (/^1970-01-01\b/.test(s) || s === '0') return '';
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const num = Number(s);
    if (num > 86400) {
        const d = new Date(num * (num < 10000000000 ? 1000 : 1));
        const p = function (n) { return String(n).padStart(2, '0'); };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }
    return '';
}

function detectDark() {
    if (typeof document === 'undefined') return false;
    const html = document.documentElement;
    if (html && html.getAttribute('data-darkmode') === 'true') return true;
    if (document.body && document.body.classList.contains('dark')) return true;
    if (html && html.getAttribute('data-darkmode') === 'false') return false;
    return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function createShell(opts) {
    ensureStyles();
    const root = E('div', { class: 'nk-root', 'data-nk-theme': detectDark() ? 'dark' : 'light' });
    if (typeof window !== 'undefined' && window.matchMedia) {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        if (mq && mq.addEventListener) mq.addEventListener('change', function () {
            root.setAttribute('data-nk-theme', detectDark() ? 'dark' : 'light');
        });
    }

    // Top bar: 6 pill tabs (instant SPA switching without page reload flash) + persistent right-side Reset & Save
    bindPopstate();
    const nav = E('div', { class: 'nk-nav-tabs', role: 'navigation', 'aria-label': 'Nikki Concord' }, TABS.map(function (t) {
        const href = tabHref(t);
        const link = E('a', {
            href: href,
            'data-tab': t.id,
            class: 'nk-nav-tab' + (t.id === opts.activeTab ? ' is-active' : '')
        }, t.label());
        link.addEventListener('click', function (ev) {
            if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
            ev.preventDefault();
            navigateTo(t.id, true);
        });
        return link;
    }));

    const dirtyText = E('span', {}, '');
    const dirtyPill = E('span', { class: 'nk-dirty-pill nk-hidden' }, [
        E('span', { class: 'nk-dirty-dot' }),
        dirtyText
    ]);
    const resetBtn = E('button', { type: 'button', class: 'nk-btn', disabled: '' }, _('Reset'));
    const saveBtn = E('button', { type: 'button', class: 'nk-btn nk-btn-primary', disabled: '' }, _('Save'));
    const saveGroup = E('div', { class: 'nk-top-save' + (opts.showSave === false ? ' nk-hidden' : '') }, [
        dirtyPill, resetBtn, saveBtn
    ]);

    resetBtn.addEventListener('click', function () {
        if (opts.onReset) opts.onReset();
    });
    saveBtn.addEventListener('click', function () {
        if (opts.onSave) opts.onSave();
    });

    const topbar = E('div', { class: 'nk-topbar' }, [nav, saveGroup]);

    // Hero band
    const stateText = E('span', {}, _('Status unavailable'));
    const statusEl = E('div', { class: 'nk-hero-status' }, [
        stateText,
        E('span', { class: 'nk-status-ring', 'aria-hidden': 'true' })
    ]);
    const feedEl = E('div', { class: 'nk-hero-feed' });

    const hero = E('div', { class: 'nk-hero' }, [
        E('h1', { class: 'nk-hero-title' }, 'Nikki Concord'),
        statusEl,
        E('p', { class: 'nk-hero-sub' }, [
            E('span', {}, _('Transparent Proxy with Concord on OpenWrt.')),
            E('a', {
                href: 'https://github.com/user-7392/nikki-concord#下载安装',
                target: '_blank',
                rel: 'noopener noreferrer'
            }, _('How To Use'))
        ]),
        feedEl
    ]);

    // Alert details modal
    const modalTitle = E('h3', { class: 'nk-modal-title' }, '');
    const modalBody = E('div', { class: 'nk-modal-body' });
    const modalDismissBar = E('div', { class: 'nk-dismiss-bar nk-hidden', style: 'margin:0 20px 12px;' });
    const modalCopyBtn = E('button', { type: 'button', class: 'nk-btn nk-btn-sm' }, _('Copy'));
    const modalDlBtn = E('button', { type: 'button', class: 'nk-btn nk-btn-sm' }, _('Download Report'));
    const modalMinBtn = E('button', { type: 'button', class: 'nk-icon-btn', title: _('Close') }, [svgEl('close')]);
    const alertModal = E('div', { class: 'nk-modal-backdrop nk-hidden' }, [
        E('div', { class: 'nk-modal' }, [
            E('div', { class: 'nk-modal-head' }, [modalTitle, modalMinBtn]),
            modalBody,
            modalDismissBar,
            E('div', { class: 'nk-modal-foot' }, [
                E('button', {
                    type: 'button',
                    class: 'nk-btn nk-btn-sm nk-btn-ghost',
                    click: function () { modalDismissBar.classList.toggle('nk-hidden'); }
                }, _('Mute Alert')),
                modalCopyBtn,
                modalDlBtn
            ])
        ])
    ]);
    modalMinBtn.addEventListener('click', function () {
        modalDismissBar.classList.add('nk-hidden');
        alertModal.classList.add('nk-hidden');
    });
    alertModal.addEventListener('click', function (ev) {
        if (ev.target === alertModal) {
            modalDismissBar.classList.add('nk-hidden');
            alertModal.classList.add('nk-hidden');
        }
    });

    const contentHost = E('div', {});
    root.appendChild(topbar);
    root.appendChild(hero);
    root.appendChild(contentHost);
    root.appendChild(alertModal);

    activeRoot = root;
    activeContent = contentHost;
    activeTabId = opts.activeTab || '';
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(function () {
            const act = nav.querySelector('.nk-nav-tab.is-active');
            if (act && act.scrollIntoView) {
                try { act.scrollIntoView({ inline: 'nearest', block: 'nearest' }); } catch (_) {}
            }
        });
    }

    // Live core status + feed state
    let latestRunning = false;
    let transientLock = false;
    let activeAlert = null;
    let prevAlertSig = '';
    let feedPriority = 'none'; // 'upgrade' | 'prompt' | 'alert' | 'none'

    function setLiveState(label, colorVar, busy) {
        statusEl.style.color = colorVar;
        statusEl.classList.toggle('is-busy', !!busy);
        stateText.textContent = label;
    }

    function applyStatus(st) {
        if (st && typeof st.running === 'boolean') lastKnownStatus = st;
        if (transientLock) return;
        latestRunning = !!(st && st.running);
        if (st && st.running && st.state === 'ready') {
            setLiveState(_('Service Running'), 'var(--sp-success)', false);
        } else if (st && st.running === false) {
            setLiveState(_('Service Not Running'), 'var(--sp-danger)', false);
        } else if (st && st.state === 'upgrade-restart-required') {
            setLiveState(_('Update installed. Restart the service to apply it.'), 'var(--sp-warning)', false);
        } else if (st && st.state === 'rules-pending') {
            setLiveState(_('Rule sets pending') + ' (' + (st.pending || 0) + ')', 'var(--sp-warning)', true);
        } else if (st && st.running) {
            setLiveState(_('Core API unavailable'), 'var(--sp-warning)', false);
        } else {
            setLiveState(_('Status unavailable'), 'var(--sp-muted)', false);
        }
    }

    function buildAlertMarkdown(a) {
        const lines = ['# ' + a.title, '', '> ' + new Date().toLocaleString(), ''];
        a.items.forEach(function (it, idx) {
            const head = [it.path, it.code].filter(Boolean).join(' · ');
            lines.push((idx + 1) + '. ' + (head ? '**`' + head + '`** ' : '') + (it.message || ''));
        });
        return lines.join('\n') + '\n';
    }

    function finishDismiss(sig, mode) {
        saveMute(sig, mode);
        activeAlert = null;
        alertModal.classList.add('nk-hidden');
        modalDismissBar.classList.add('nk-hidden');
        feedPriority = 'none';
        feedEl.classList.remove('is-wide');
        feedEl.replaceChildren();
    }

    function renderDismissInline(sig, rerender) {
        feedEl.classList.remove('is-wide');
        feedEl.replaceChildren(E('div', { class: 'nk-dismiss-bar' }, [
            E('span', {}, _('Mute this alert:')),
            E('button', { type: 'button', class: 'nk-btn nk-btn-sm', click: function () { finishDismiss(sig, 'day'); } }, _('Mute 1 Day')),
            E('button', { type: 'button', class: 'nk-btn nk-btn-sm nk-btn-primary', click: function () { finishDismiss(sig, 'forever'); } }, _('Mute Permanently')),
            E('button', { type: 'button', class: 'nk-btn nk-btn-sm nk-btn-ghost', click: rerender }, _('Cancel'))
        ]));
    }

    function openAlertModal() {
        if (!activeAlert) return;
        modalTitle.textContent = activeAlert.title;
        modalBody.replaceChildren(E('ul', { class: 'nk-alert-list' }, activeAlert.items.map(function (it) {
            return E('li', { class: 'nk-alert-item' }, [
                (it.path || it.code) ? E('div', { class: 'nk-alert-item-head' }, [
                    E('span', { class: 'nk-mono' }, it.path || ''),
                    E('span', { class: 'nk-mono' }, it.code || '')
                ]) : '',
                E('div', { class: 'nk-alert-item-msg' }, it.message || '')
            ]);
        })));
        modalDismissBar.classList.add('nk-hidden');
        modalDismissBar.replaceChildren(
            E('span', {}, _('Mute this alert:')),
            E('button', { type: 'button', class: 'nk-btn nk-btn-sm', click: function () { finishDismiss(activeAlert.sig, 'day'); } }, _('Mute 1 Day')),
            E('button', { type: 'button', class: 'nk-btn nk-btn-sm nk-btn-primary', click: function () { finishDismiss(activeAlert.sig, 'forever'); } }, _('Mute Permanently')),
            E('button', { type: 'button', class: 'nk-btn nk-btn-sm nk-btn-ghost', click: function () { modalDismissBar.classList.add('nk-hidden'); } }, _('Cancel'))
        );
        modalCopyBtn.onclick = function () { copyText(buildAlertMarkdown(activeAlert), modalCopyBtn, _('Copy')); };
        modalDlBtn.onclick = function () { downloadFile('nikki-concord-report.md', buildAlertMarkdown(activeAlert), 'text/markdown;charset=utf-8'); };
        alertModal.classList.remove('nk-hidden');
    }

    function applyWarnings(report) {
        if (feedPriority === 'upgrade' || feedPriority === 'prompt') return;
        const items = [];
        let title = '';
        let isError = false;
        if (report && report.error) {
            isError = true;
            title = _('Concord configuration was rejected');
            items.push({ path: 'config', code: 'error', message: report.error });
        } else if (report && Array.isArray(report.warnings) && report.warnings.length) {
            const total = report.total || report.warnings.length;
            title = _('Concord configuration warnings') + ' (' + total + ')';
            report.warnings.forEach(function (w) { items.push(w); });
        }
        if (!items.length) {
            if (feedPriority === 'alert') {
                feedPriority = 'none';
                feedEl.classList.remove('is-wide');
                feedEl.replaceChildren();
            }
            activeAlert = null;
            prevAlertSig = '';
            return;
        }
        const sig = hashString(JSON.stringify(items));
        if (isMuted(sig)) {
            if (feedPriority === 'alert') {
                feedPriority = 'none';
                feedEl.classList.remove('is-wide');
                feedEl.replaceChildren();
            }
            return;
        }
        if (sig === prevAlertSig && feedPriority === 'alert') return;
        prevAlertSig = sig;
        activeAlert = { title: title, items: items, sig: sig, isError: isError };

        function paintTicker() {
            feedPriority = 'alert';
            const singleLine = items.length === 1
                ? [items[0].path, items[0].message].filter(Boolean).join(' · ')
                : title + '：' + items.map(function (it) {
                    return (it.path ? '[' + it.path + '] ' : '') + (it.message || '');
                }).join('   ·   ');
            const textSpan = E('span', {}, singleLine);
            const track = E('div', { class: 'nk-ticker-track' }, [textSpan]);
            const viewport = E('div', { class: 'nk-ticker-viewport' }, [track]);
            const closeBtn = E('button', {
                type: 'button', class: 'nk-ticker-btn', title: _('Close'),
                click: function () { renderDismissInline(sig, paintTicker); }
            }, [svgEl('close')]);
            const expandBtn = E('button', {
                type: 'button', class: 'nk-ticker-btn nk-hidden', title: _('Expand'),
                click: openAlertModal
            }, [svgEl('expand')]);
            const copyBtn = E('button', {
                type: 'button', class: 'nk-ticker-btn nk-hidden', title: _('Copy'),
                click: function () { copyText(singleLine, copyBtn); }
            }, [svgEl('copy')]);
            feedEl.classList.add('is-wide');
            feedEl.replaceChildren(E('div', { class: 'nk-alert-ticker' + (isError ? ' is-error' : '') }, [
                closeBtn, viewport, expandBtn, copyBtn
            ]));
            requestAnimationFrame(function () {
                const overflows = items.length > 1 || textSpan.scrollWidth > viewport.clientWidth - 6;
                if (overflows) {
                    const dur = Math.max(22, Math.round((textSpan.scrollWidth + 56) / 34));
                    track.style.setProperty('--nk-marquee-dur', dur + 's');
                    const clone = textSpan.cloneNode(true);
                    clone.setAttribute('aria-hidden', 'true');
                    track.appendChild(clone);
                    track.classList.add('is-scrolling');
                    expandBtn.classList.remove('nk-hidden');
                } else {
                    viewport.classList.add('is-static');
                    copyBtn.classList.remove('nk-hidden');
                }
            });
        }
        paintTicker();
    }

    function setFeed(priority, wide, nodes) {
        feedPriority = priority || 'none';
        feedEl.classList.toggle('is-wide', !!wide);
        feedEl.replaceChildren(...(Array.isArray(nodes) ? nodes : (nodes ? [nodes] : [])));
    }

    function setDirtyCount(n) {
        const count = Number(n) || 0;
        dirtyPill.classList.toggle('nk-hidden', count === 0);
        if (count > 0) dirtyText.textContent = count + ' ' + _('unsaved changes');
        resetBtn.disabled = count === 0;
        saveBtn.disabled = count === 0;
    }

    function setSaveVisible(visible) {
        saveGroup.classList.toggle('nk-hidden', !visible);
    }

    function setBusy(label, colorVar) {
        transientLock = true;
        setLiveState(label, colorVar || 'var(--sp-cobalt)', true);
    }

    function endBusy(nextStatus) {
        transientLock = false;
        if (nextStatus) applyStatus(nextStatus);
    }

    if (lastKnownStatus) applyStatus(lastKnownStatus);

    return {
        root: root,
        content: contentHost,
        feedEl: feedEl,
        saveBtn: saveBtn,
        resetBtn: resetBtn,
        setDirtyCount: setDirtyCount,
        setSaveVisible: setSaveVisible,
        applyStatus: applyStatus,
        applyWarnings: applyWarnings,
        setFeed: setFeed,
        setBusy: setBusy,
        endBusy: endBusy,
        isRunning: function () { return latestRunning; }
    };
}

// Single-slot visibility-aware polling helper (prevents duplicate timers across SPA tab switches)
function attachPolling(fn, intervalSec) {
    activePollFn = fn;
    if (pollRegistered) return;
    pollRegistered = true;
    poll.add(function () {
        if (typeof document !== 'undefined' && document.hidden) return Promise.resolve();
        if (!activePollFn) return Promise.resolve();
        return Promise.resolve(activePollFn()).catch(function () {});
    }, intervalSec || 5);
    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden && activePollFn) Promise.resolve(activePollFn()).catch(function () {});
        });
    }
}

function attachStatusPoll(shell, extraCb) {
    attachPolling(function () {
        return nikkic.overview('').then(function (ov) {
            shell.applyStatus(ov.status);
            shell.applyWarnings(ov.warnings);
            if (extraCb) return extraCb(ov);
        });
    }, 5);
}

// Commit staged UCI changes permanently (rollback: false) and immediately clear LuCI's top navbar unsaved indicator
async function commitUci() {
    await uci.save();
    if (typeof uci.callApply === 'function') {
        const rv = await uci.callApply(10, false);
        if (rv != null && rv !== 0) throw new Error('UCI apply failed (' + rv + ')');
    } else {
        await uci.apply();
    }
    try {
        if (typeof document !== 'undefined' && typeof CustomEvent !== 'undefined' && document.dispatchEvent)
            document.dispatchEvent(new CustomEvent('uci-applied'));
        if (luciUi && luciUi.changes && typeof luciUi.changes.init === 'function') {
            await luciUi.changes.init();
        } else if (luciUi && luciUi.changes && typeof luciUi.changes.setIndicator === 'function') {
            luciUi.changes.setIndicator(0);
        }
    } catch (_) {}
}

// Finalized Save Rule:
// - If running: save UCI, then smoothly reload (正在重载… -> 服务运行中, never flashing red)
// - If stopped: save UCI only, do NOT start or reload
async function saveWithSmartReload(shell, saveTask) {
    const wasRunning = shell.isRunning();
    shell.saveBtn.disabled = true;
    try {
        await saveTask();
        if (wasRunning) {
            shell.setBusy(_('Reloading...'), 'var(--sp-cobalt)');
            await nikkic.reload();
            const ov = await nikkic.overview('');
            shell.endBusy(ov.status);
            shell.applyWarnings(ov.warnings);
        }
    } catch (err) {
        const ov = await nikkic.overview('').catch(function () { return null; });
        shell.endBusy(ov && ov.status);
        shell.setFeed('prompt', false, [
            E('div', { style: 'color:var(--sp-danger);font-weight:600;' }, String(err && err.message ? err.message : err))
        ]);
        throw err;
    }
}

return baseclass.extend({
    ICONS: ICONS,
    svgEl: svgEl,
    ensureStyles: ensureStyles,
    isClassicMode: isClassicMode,
    setClassicMode: setClassicMode,
    delegateClassic: delegateClassic,
    navigateTo: navigateTo,
    createShell: createShell,
    createEnableBtn: createEnableBtn,
    createSegmented: createSegmented,
    createCombo: createCombo,
    createPasswordInput: createPasswordInput,
    createChipBox: createChipBox,
    createOverwriteCard: createOverwriteCard,
    renderFieldGrid: renderFieldGrid,
    attachPolling: attachPolling,
    attachStatusPoll: attachStatusPoll,
    commitUci: commitUci,
    saveWithSmartReload: saveWithSmartReload,
    copyText: copyText,
    downloadFile: downloadFile,
    formatSize: formatSize,
    parseSizeToGB: parseSizeToGB,
    formatGB: formatGB,
    formatShortStamp: formatShortStamp,
    formatExpireDate: formatExpireDate
});
