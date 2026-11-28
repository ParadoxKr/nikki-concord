#!/bin/sh
set -eu
umask 077
config_dir=${UCI_CONFIG_DIR:-/etc/config}
uci_get() { uci -c "$config_dir" "$@"; }
[ "$(uci_get -q get nikkic.config.init || :)" = 1 ] || exit 0
api_secret=$(head -c 32 /dev/urandom | hexdump -ve '1/1 "%02x"')
proxy_password=$(head -c 24 /dev/urandom | hexdump -ve '1/1 "%02x"')
[ "${#api_secret}" -eq 64 ] && [ "${#proxy_password}" -eq 48 ] || exit 1
uci_get set "nikkic.mixin.api_secret=$api_secret"
uci_get set "nikkic.@authentication[0].password=$proxy_password"
uci_get delete nikkic.config.init
uci_get commit nikkic
