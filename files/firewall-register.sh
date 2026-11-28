#!/bin/sh
set -eu

[ -z "${IPKG_INSTROOT:-}" ] || exit 0
[ "${IPKG_NO_SCRIPT:-0}" != 1 ] || exit 0
config_dir=${UCI_CONFIG_DIR:-/etc/config}
[ -f "$config_dir/firewall" ] || exit 0
firewall_uci() { uci -c "$config_dir" "$@"; }

section=$(firewall_uci -q get firewall.nikkic || :)
script=/etc/nikkic/scripts/firewall_include.sh
configured=$(firewall_uci -q get firewall.nikkic.path || :)
if [ "${NIKKIC_REMOVE_FIREWALL:-0}" = 1 ]; then
    if [ "$section" = include ] && [ "$configured" = "$script" ]; then
        firewall_uci delete firewall.nikkic
        firewall_uci commit firewall
    fi
    exit 0
fi
if [ -n "$section" ] && { [ "$section" != include ] || [ "$configured" != "$script" ]; }; then
    echo "Nikki Concord: firewall.nikkic is already used by another configuration." >&2
    exit 1
fi
if [ "$section" = include ] &&
    [ "$(firewall_uci -q get firewall.nikkic.type || :)" = script ] &&
    [ "$(firewall_uci -q get firewall.nikkic.fw4_compatible || :)" = 1 ]; then
    exit 0
fi
firewall_uci batch <<EOF
set firewall.nikkic=include
set firewall.nikkic.type=script
set firewall.nikkic.path=$script
set firewall.nikkic.fw4_compatible=1
commit firewall
EOF
