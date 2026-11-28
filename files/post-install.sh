#!/bin/sh
set -eu

[ -z "${IPKG_INSTROOT:-}" ] || exit 0
[ "${IPKG_NO_SCRIPT:-0}" != 1 ] || exit 0

upgrade_pid=''
if [ "${NIKKIC_PACKAGE_UPGRADE:-0}" = 1 ]; then
    upgrade_pid=$(/etc/nikkic/scripts/health.sh --record-upgrade) ||
        echo 'Unable to check whether Nikki Concord needs a restart after upgrade.' >&2
fi

/etc/nikkic/scripts/first-boot.sh
/etc/nikkic/scripts/firewall-register.sh
/etc/init.d/nikkic enable
if [ -x /etc/init.d/ucitrack ] && ubus -t 2 list service | grep -qx service; then
    /etc/init.d/ucitrack reload
fi
if [ -n "$upgrade_pid" ]; then
    /etc/init.d/nikkic reload after-upgrade "$upgrade_pid" ||
        echo 'Nikki Concord could not restart after upgrade. Check the service logs.' >&2
fi
rm -f /tmp/luci-indexcache /tmp/luci-indexcache.*
rm -rf /tmp/luci-modulecache/

# An offline image or router with rpcd disabled loads the installed module at boot.
if ! ubus -t 2 list session 2>/dev/null | grep -qx session; then
    exit 0
fi

wait_for_luci() {
    for attempt in 1 2 3 4 5; do
        if ubus -t 2 call luci.nikkic version >/dev/null 2>&1 &&
            ubus -t 2 -v list luci.nikkic | grep -q '"get_identifiers"'; then
            return 0
        fi
        sleep 1
    done
    return 1
}

/etc/init.d/rpcd reload 2>/dev/null || :
if wait_for_luci; then
    exit 0
fi

/etc/init.d/rpcd restart
if ! wait_for_luci; then
    echo "Nikki Concord was installed, but LuCI could not register its RPC module." >&2
    exit 1
fi
