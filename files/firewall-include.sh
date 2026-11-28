#!/bin/sh

. "$IPKG_INSTROOT/etc/nikkic/scripts/include.sh"

[ -f "$TEMP_DIR/hijack-owned" ] || exit 0
exec 9>"$TEMP_DIR/fw4-include.lock"
flock -x 9 || exit 1
[ -f "$TEMP_DIR/hijack-owned" ] || exit 0

device=$(cat "$TEMP_DIR/tun-device" 2>/dev/null || :)
if [ -z "$device" ]; then
    # r9 did not record the device. Support an active service during an upgrade.
    device=$(yq -M -r '.tun | select(.enable == true) | .device // ""' "$RUN_PROFILE_PATH")
fi
[ -n "$device" ] && ip link show dev "$device" >/dev/null 2>&1 || exit 0

ensure_rule() {
    chain=$1
    interface=$2
    if nft list chain inet fw4 "$chain" 2>/dev/null | grep -F "$interface \"$device\"" | grep -Fq 'comment "nikkic"'; then
        return 0
    fi
    nft insert rule inet fw4 "$chain" "$interface" "$device" counter accept comment nikkic
}
ensure_rule input iifname &&
    ensure_rule forward oifname &&
    ensure_rule forward iifname
